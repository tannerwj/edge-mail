import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";
import { api, activeBindings } from "./cloud-cli.mjs";
import { restoreTarget } from "./recovery-target.mjs";

const { values } = parseArgs({
  options: {
    worker: { type: "string" },
    bucket: { type: "string" },
    snapshot: { type: "string" },
    check: { type: "boolean" },
    apply: { type: "boolean" },
  },
});
assert.ok(
  values.check !== values.apply && (values.check || values.apply),
  "Select --check or --apply",
);
assert.equal(
  [values.worker, values.bucket].filter(Boolean).length,
  1,
  "Choose the installed --worker or a recovery --bucket",
);
if (values.worker) assert.match(values.worker, /^edge-mail(?:-[a-z0-9-]+)?$/);
if (values.bucket) assert.match(values.bucket, /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
const [account, ...other] = api("auth", "whoami").accounts;
assert.ok(account?.id && !other.length, "Select the profile for the installation account");
const bindings = values.worker ? activeBindings(values.worker) : [];
const sourceDb = values.bucket
  ? "r2:" + account.id + "/" + values.bucket
  : bindings.find((b) => b.type === "d1" && b.name === "DB")?.database_id;
const bucket =
  values.bucket || bindings.find((b) => b.type === "r2_bucket" && b.name === "MAIL")?.bucket_name;
assert.ok(sourceDb && bucket, "The installed Worker must have both DB and MAIL bindings");
function latestSnapshot() {
  assert.ok(
    values.check && values.worker,
    "Supply the snapshot ID printed by a Worker preview or backup:copy --status",
  );
  const sql =
    "SELECT id FROM snapshot_runs WHERE phase='complete' ORDER BY created_at DESC,id DESC LIMIT 1";
  return api("d1", "query", sourceDb, "--body", JSON.stringify({ sql }))[0].results[0]?.id;
}
const snapshot = values.snapshot ?? latestSnapshot();
assert.match(snapshot || "", /^[a-zA-Z0-9_-]{1,100}$/, "Choose a completed snapshot ID");
const manifest = api(
  "r2",
  "objects",
  "get",
  "snapshots/" + snapshot + "/manifest.json",
  "--bucket-name",
  bucket,
);
assert.ok(
  manifest.id === snapshot &&
    manifest.format === 1 &&
    manifest.bookmark &&
    Array.isArray(manifest.parts),
  "Select a published snapshot",
);
const digest = createHash("sha256")
  .update(JSON.stringify([account.id, sourceDb, bucket, snapshot, manifest.bookmark]))
  .digest("hex")
  .slice(0, 12);
const name = "edge-mail-drill-" + digest;
const worker = name + "-restore";
console.log(
  JSON.stringify({
    account: account.id,
    sourceWorker: values.worker,
    sourceBucket: bucket,
    snapshot,
    parts: manifest.parts.length,
    isolatedDatabase: name,
    isolatedBucket: name,
    scheduledWorker: worker,
  }),
);
if (values.apply) {
  mkdirSync(".release-lock");
  try {
    const { evidence } = await restoreTarget({ name, sourceDb, bucket, snapshot, worker });
    console.log(JSON.stringify({ restored: snapshot, isolatedTarget: name, ...evidence }));
  } finally {
    rmSync(".release-lock", { recursive: true, force: true });
  }
}
