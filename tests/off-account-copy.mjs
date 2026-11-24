import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
const temp = await mkdtemp(join(tmpdir(), "mail-backup-e2e-"));
const socket = net.createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const addr = "127.0.0.1:" + socket.address().port;
await new Promise((done) => socket.close(done));
const secret = randomBytes(32).toString("hex");
const env = {
  ...process.env,
  RCLONE_CONFIG: "/dev/null",
  RCLONE_CONFIG_FIXTURE_TYPE: "s3",
  RCLONE_CONFIG_FIXTURE_PROVIDER: "Other",
  RCLONE_CONFIG_FIXTURE_ENDPOINT: "http://" + addr,
  RCLONE_CONFIG_FIXTURE_ACCESS_KEY_ID: "fixture",
  RCLONE_CONFIG_FIXTURE_SECRET_ACCESS_KEY: secret,
  RCLONE_CONFIG_FIXTURE_REGION: "us-east-1",
  RCLONE_AUTH_KEY: JSON.stringify("fixture," + secret),
};
const server = spawn("rclone", ["serve", "s3", temp, "--addr", addr], { env, stdio: "ignore" });
const run = (bin, args, input) =>
  execFileSync(bin, args, { env, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const r = (args, input) => run("rclone", args, input);
try {
  for (let n = 0; n < 80; n++) {
    try {
      await fetch("http://" + addr);
      break;
    } catch {
      await sleep(100);
    }
  }
  const src = "fixture:source-test",
    dst = "fixture:backup-test";
  for (const bucket of [src, dst]) r(["mkdir", bucket]);
  const prefix = "snapshots/fixture/";
  const contents = JSON.stringify({ table: "labels", rows: [] });
  const part = {
    key: prefix + "labels/0.json",
    digest: createHash("sha256").update(contents).digest("hex"),
    count: 0,
  };
  const inventory = JSON.stringify({
    objects: [{ key: "raw/box/original.eml", customMetadata: { receipt: "fixture-envelope" } }],
  });
  const rawPart = {
    key: prefix + "inventory/0.json",
    digest: createHash("sha256").update(inventory).digest("hex"),
    count: 1,
  };
  const manifest = {
    id: "fixture",
    format: 1,
    at: new Date(0).toISOString(),
    bookmark: "fixture-bookmark",
    parts: [part, rawPart],
  };
  const put = (key, data, metadata) =>
    r(
      ["rcat", src + "/" + key, ...(metadata ? ["--metadata", "--metadata-set", metadata] : [])],
      data,
    );
  put(rawPart.key, inventory, "digest=" + rawPart.digest);
  put(part.key, contents, "digest=" + part.digest);
  put(
    prefix + "manifest.json",
    JSON.stringify(manifest),
    "digest=" + createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
  );
  put(
    "raw/box/original.eml",
    "Subject: local fixture\r\n\r\nFictional receipt",
    "receipt=fixture-envelope",
  );
  put("sent/box/private.envelope.json", JSON.stringify({ bcc: ["archive@example.invalid"] }));
  put("deletions/messages/box/1.json", "{}");
  const cmd = (mode) =>
    run(process.execPath, [
      "scripts/backup-copy.mjs",
      mode,
      "--source",
      src,
      "--destination",
      dst,
      "--snapshot",
      "fixture",
    ]);
  assert.equal(
    JSON.parse(r(["lsjson", src + "/raw/box/original.eml", "--stat", "--metadata"])).Metadata
      .receipt,
    "fixture-envelope",
    "fixture source must retain user metadata",
  );
  cmd("--check");
  assert.equal(r(["lsf", dst]).trim(), "");
  cmd("--apply");
  assert.equal(
    JSON.parse(r(["lsjson", dst + "/raw/box/original.eml", "--stat", "--metadata"])).Metadata
      .receipt,
    "fixture-envelope",
  );
  assert.equal(
    JSON.parse(r(["lsjson", dst + "/" + part.key, "--stat", "--metadata"])).Metadata.digest,
    part.digest,
  );
  assert.deepEqual(JSON.parse(r(["cat", dst + "/sent/box/private.envelope.json"])).bcc, [
    "archive@example.invalid",
  ]);
  put("person-erasures/v1/user.json", "{}");
  cmd("--apply");
  assert.equal(r(["cat", dst + "/person-erasures/v1/user.json"]), "{}");
  assert.equal(r(["cat", dst + "/deletions/messages/box/1.json"]), "{}");
  assert.equal(JSON.parse(cmd("--status")).snapshot, "fixture");
  // A corrupt part must never advertise another complete recovery point.
  const broken = {
    ...manifest,
    id: "broken",
    parts: [{ ...part, key: "snapshots/broken/labels/0.json" }],
  };
  put(broken.parts[0].key, "wrong data");
  put("snapshots/broken/manifest.json", JSON.stringify(broken));
  assert.throws(() =>
    run(process.execPath, [
      "scripts/backup-copy.mjs",
      "--apply",
      "--source",
      src,
      "--destination",
      dst,
      "--snapshot",
      "broken",
    ]),
  );
  assert.equal(JSON.parse(cmd("--status")).snapshot, "fixture");
  assert.equal(r(["lsf", dst + "/snapshots/broken"]).includes("manifest.json"), false);
  console.log(
    "PASS · copied receipt metadata, private Sent envelope, checksummed snapshot and late deletion records across S3 buckets; a corrupt recovery point stayed unpublished",
  );
} finally {
  const stopped = once(server, "exit");
  server.kill();
  await stopped;
  await rm(temp, { recursive: true, force: true });
}
