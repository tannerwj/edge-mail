import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { activeBindings, api, cf, pages } from "./cloud-cli.mjs";

const [mode, requested, ...extra] = process.argv.slice(2);
function resolveHost(host) {
  assert.ok(/^[a-z0-9.-]+$/.test(host || ""), "Supply the installed app hostname");
  const workers = pages(["workers", "list"]);
  for (const item of workers) {
    if (api("workers", "get", item.name).references?.domains?.some((d) => d.hostname === host))
      return item.name;
  }
  throw new Error("No Worker in this account owns " + host);
}
const worker =
  requested === "--host" && extra.length === 1 ? resolveHost(extra.shift()) : requested;
assert.ok(
  ["--check", "--apply"].includes(mode) &&
    !extra.length &&
    /^[a-z0-9][a-z0-9-]*$/.test(worker || ""),
  "Use pnpm domains:sync --check or --apply, followed by the installed Worker name",
);
const identity = api("auth", "whoami");
assert.equal(identity.accounts.length, 1, "Select the CLI profile for the installation account");
const account = identity.accounts[0].id;
const bindings = activeBindings(worker);
const bucket = bindings.find((b) => b.type === "r2_bucket" && b.name === "MAIL")?.bucket_name;
assert.ok(
  bucket && bindings.some((b) => b.type === "d1" && b.name === "DB"),
  "Missing Edge Mail storage bindings",
);

const zones = [];
const seen = new Set();
for (let page = 1; ; page++) {
  const rows = api(
    "zones",
    "list",
    "--account-id",
    account,
    "--status",
    "active",
    "--order",
    "name",
    "--per-page",
    "50",
    "--page",
    String(page),
  );
  assert.ok(Array.isArray(rows));
  for (const zone of rows) {
    assert.ok(
      zone.account?.id === account && zone.status === "active" && !seen.has(zone.id),
      "Zone inventory changed during discovery. Retry the refresh.",
    );
    zones.push({ id: zone.id, name: zone.name });
    seen.add(zone.id);
  }
  if (rows.length < 50) break;
}
const work = mkdtempSync(join(tmpdir(), "edge-mail-zone-list-"));
try {
  const file = join(work, "catalog.json");
  writeFileSync(
    file,
    JSON.stringify({ account, worker, updated: new Date().toISOString(), zones }),
    {
      mode: 0o600,
    },
  );
  const put = [
    "r2",
    "objects",
    "put",
    "instance/zone-catalog.json",
    "--bucket-name",
    bucket,
    "--file",
    file,
    "--content-type",
    "application/json",
  ];
  cf([...put, "--dry-run"]);
  if (mode === "--apply") {
    cf(put);
    const result = api(
      "r2",
      "objects",
      "get",
      "instance/zone-catalog.json",
      "--bucket-name",
      bucket,
    );
    assert.equal(result.account, account);
    assert.deepEqual(result.zones, zones);
  }
  console.log(
    (mode === "--apply" ? "Synced " : "Previewed ") +
      zones.length +
      " active Cloudflare zones for " +
      worker +
      ".",
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
