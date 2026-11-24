import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    destination: { type: "string" },
    snapshot: { type: "string" },
    check: { type: "boolean" },
    apply: { type: "boolean" },
    status: { type: "boolean" },
  },
});
const { source, destination, snapshot } = values;
const bucket = /^[A-Za-z0-9_][A-Za-z0-9_-]*:[a-z0-9][a-z0-9.-]+$/;
assert.ok(
  bucket.test(destination) &&
    [values.check, values.apply, values.status].filter(Boolean).length === 1,
  "Choose --check, --apply or --status and a named rclone destination remote:bucket",
);
function run(args, input) {
  const result = spawnSync("rclone", [...args, "--log-level", "ERROR"], {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw Error(
      "rclone " +
        args[0] +
        " failed. Check the rclone installation, remote permissions, free space and connectivity.",
    );
  return result.stdout;
}
const path = (root, key) => root + "/" + key;
const logPrefix = "replication/checkpoints";
function json(root, key) {
  return JSON.parse(run(["cat", path(root, key)]));
}
function metadata(root, key) {
  return JSON.parse(run(["lsjson", path(root, key), "--stat", "--metadata"])).Metadata;
}
function receipt() {
  const records = run(["lsf", path(destination, logPrefix), "--files-only"])
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.ok(records.length, "No complete recovery checkpoint");
  const points = records.map((name) => {
    const fields = /^(\d+)-(\d+)-([a-zA-Z0-9_-]+)\.json$/.exec(name);
    assert.ok(fields, "Unrecognized recovery checkpoint");
    return { point: Number(fields[1]), finished: Number(fields[2]), name };
  });
  const latest = points.reduce((a, b) => (b.point > a.point ? b : a));
  const lastSync = points.reduce((a, b) => (b.finished > a.finished ? b : a));
  const recovery = json(destination, logPrefix + "/" + latest.name),
    sync = json(destination, logPrefix + "/" + lastSync.name);
  console.log(
    JSON.stringify({
      snapshot: recovery.snapshot,
      recoveryPoint: recovery.recoveryPoint,
      completed: sync.completed,
      deletionLagSeconds: Math.ceil(
        Math.max(0, Date.now() - Date.parse(sync.deletionsCheckedFrom)) / 1000,
      ),
    }),
  );
}
function verifyPart(part) {
  const text = run(["cat", path(destination, part.key)]);
  assert.equal(
    createHash("sha256").update(text).digest("hex"),
    part.digest,
    "Recovery part checksum mismatch",
  );
  assert.equal(
    metadata(destination, part.key).digest,
    part.digest,
    "Snapshot digest metadata missing",
  );
  if (!part.key.includes("/inventory/")) return;
  const raw = JSON.parse(text).objects.filter((v) => v.key.startsWith("raw/"));
  if (!raw.length) return;
  const expected = new Map(raw.map((v) => [v.key, v.customMetadata?.receipt]));
  const recovered = JSON.parse(
    run(
      ["lsjson", destination, "--recursive", "--files-only", "--metadata", "--files-from-raw", "-"],
      raw.map((v) => v.key).join("\n") + "\n",
    ),
  );
  for (const obj of recovered)
    assert.ok(
      obj.Metadata?.receipt && obj.Metadata.receipt === expected.get(obj.Path),
      "Raw receipt envelope metadata differs",
    );
}
function copy() {
  assert.ok(
    bucket.test(source) && source !== destination && /^[a-zA-Z0-9_-]{1,100}$/.test(snapshot),
    "Choose distinct source and destination buckets and an existing snapshot ID",
  );
  const prefix = "snapshots/" + snapshot + "/",
    key = prefix + "manifest.json";
  const contents = run(["cat", path(source, key)]),
    manifest = JSON.parse(contents);
  assert.ok(
    manifest.id === snapshot &&
      manifest.format === 1 &&
      manifest.bookmark &&
      Number.isFinite(Date.parse(manifest.at)) &&
      Array.isArray(manifest.parts) &&
      manifest.parts.length,
    "Source snapshot has no complete manifest",
  );
  const files =
    manifest.parts
      .map((p) => {
        assert.ok(
          p.key.startsWith(prefix) &&
            /^[a-zA-Z0-9_]+\/\d+\.json$/.test(p.key.slice(prefix.length)) &&
            /^[a-f0-9]{64}$/.test(p.digest),
          "Invalid snapshot part",
        );
        return p.key;
      })
      .join("\n") + "\n";
  const migrationMarker = "replication/source.json";
  const entries = run(["lsf", destination, "--max-depth", "1"]).trim();
  if (entries) {
    assert.equal(
      json(destination, migrationMarker).source,
      source,
      "Choose a backup initialized for this source",
    );
  }
  const sync = (args, input) =>
    run([...args, "--metadata", "--checksum", ...(values.check ? ["--dry-run"] : [])], input);
  if (values.apply && !entries)
    run(["rcat", path(destination, migrationMarker)], JSON.stringify({ source }));
  const objects = ["raw", "sent", "body", "html", "att"].flatMap((p) => [
    "--include",
    "/" + p + "/**",
  ]);
  sync(["copy", source, destination, ...objects]);
  sync(["copy", source, destination, "--files-from-raw", "-"], files);
  const checked = new Date().toISOString();
  const journals = ["--include", "/deletions/**", "--include", "/person-erasures/**"];
  sync(["copy", source, destination, ...journals]);
  if (values.check) {
    console.log(
      "Previewed mail objects, snapshot parts and both deletion journals. No recovery checkpoint written.",
    );
    return;
  }
  run(["check", source, destination, "--one-way", ...objects]);
  run(["check", source, destination, "--one-way", ...journals]);
  for (const part of manifest.parts) verifyPart(part);
  const digest = createHash("sha256").update(contents).digest("hex");
  assert.equal(metadata(source, key).digest, digest, "Source manifest metadata mismatch");
  sync(["copyto", path(source, key), path(destination, key)]);
  assert.equal(run(["cat", path(destination, key)]), contents, "Recovery manifest changed");
  assert.equal(
    metadata(destination, key).digest,
    digest,
    "Recovery manifest digest metadata missing",
  );
  const state = {
    source,
    snapshot,
    recoveryPoint: manifest.at,
    deletionsCheckedFrom: checked,
    completed: new Date().toISOString(),
  };
  const record =
    Date.parse(manifest.at) + "-" + Date.parse(state.completed) + "-" + snapshot + ".json";
  run(["rcat", path(destination, logPrefix + "/" + record)], JSON.stringify(state));
  receipt();
}
if (values.status) receipt();
else copy();
