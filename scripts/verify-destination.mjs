import assert from "node:assert/strict";
import { activeBindings, api, cf, pages } from "./cloud-cli.mjs";
const [mode, worker, id, ...rest] = process.argv.slice(2);
assert.ok(
  ["--check", "--apply"].includes(mode) &&
    /^[a-z0-9-]+$/.test(worker) &&
    /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id) &&
    !rest.length,
  "Provide --check or --apply, the Worker name, and the destination ID from Settings",
);
assert.equal(api("auth", "whoami").accounts.length, 1, "Select the installation account");
const bindings = activeBindings(worker);
assert.ok(bindings.some((b) => b.name === "MAIL" && b.type === "r2_bucket"));
const db = bindings.find((b) => b.name === "DB" && b.type === "d1").database_id;
const query = (sql, params) => ["d1", "query", db, "--body", JSON.stringify({ sql, params })];
const [dest] = api(
  ...query(
    "SELECT d.address FROM egress_destinations d JOIN users u ON u.id=d.owner WHERE d.id=? AND d.disabled=0 AND u.disabled_at IS NULL",
    [id],
  ),
)[0].results;
assert.ok(dest, "Destination is disabled or unavailable");
const existing = pages(["email-routing", "addresses", "list"]).find(
  (a) => a.email.toLowerCase() === dest.address,
);
if (!existing) {
  const create = ["email-routing", "addresses", "create", "--email", dest.address];
  cf([...create, "--dry-run"]);
  console.log("Cloudflare will send a verification link to " + dest.address + ".");
  if (mode === "--apply") {
    cf(create);
    console.log("Run this command again after the recipient confirms.");
  }
} else {
  const sync = query(
    "UPDATE egress_destinations SET verified_at=? WHERE id=? AND address=? AND disabled=0",
    [existing.verified || null, id, dest.address],
  );
  cf([...sync, "--dry-run"]);
  if (mode === "--apply") cf(sync);
  console.log(
    existing.verified
      ? "Verified destination " + dest.address
      : "Waiting for the recipient to confirm " + dest.address,
  );
}
