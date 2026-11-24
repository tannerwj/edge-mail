import assert from "node:assert/strict";
import { api, cf } from "./cloud-cli.mjs";

export function protectMailboxBucket(bucket, apply) {
  const locks = api("r2", "buckets", "locks", "get", bucket).rules || [];
  const desired = ["raw", "sent", "snapshots", "deletions"].map((path) => ({
    id: "retain-" + path,
    enabled: true,
    prefix: path + "/",
    condition: { type: "Age", maxAgeSeconds: 35 * 86400 },
  }));
  const missing = desired.filter((rule) => {
    const match = locks.find((old) => old.id === rule.id);
    if (match) assert.deepEqual(match, rule, "Existing retention rule differs");
    return !match;
  });
  if (!missing.length) return;
  const args = [
    "r2",
    "buckets",
    "locks",
    "update",
    bucket,
    "--rules",
    JSON.stringify([...locks, ...missing]),
    "--force",
  ];
  cf([...args, "--dry-run"]);
  if (apply) cf(args);
}
