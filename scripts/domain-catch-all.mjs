import assert from "node:assert/strict";
import { api, cf } from "./cloud-cli.mjs";

const fields = (r) => ({
  name: r.name,
  enabled: r.enabled,
  matchers: r.matchers,
  actions: r.actions,
});
const same = (a, b) =>
  a.name === b.name &&
  a.enabled === b.enabled &&
  JSON.stringify(a.matchers) === JSON.stringify(b.matchers) &&
  JSON.stringify(a.actions) === JSON.stringify(b.actions);

export function apexRoute({ domain, zone, worker, db, disconnect, apply }) {
  const operations = ["email-routing", "rules", "catch-all"];
  const current = () => api(...operations, "get", "--zone", zone);
  const query = (sql, params) =>
    api("d1", "query", db, "--body", JSON.stringify({ sql, params }))[0].results;
  const live = fields(current()),
    next = {
      name: "Edge Mail " + worker,
      enabled: true,
      matchers: [{ type: "all" }],
      actions: [{ type: "worker", value: [worker] }],
    };
  const [record] = query("SELECT prior FROM apex_route_ownership WHERE domain=? AND worker=?", [
    domain,
    worker,
  ]);
  if (disconnect && !record) {
    console.log("No catch-all is owned by this installation.");
    return;
  }
  const prior = record ? JSON.parse(record.prior) : live;
  if (!record)
    assert.ok(
      live.actions.length === 1 && live.actions.every((a) => a.type === "drop"),
      "The existing catch-all belongs to another configuration. Use exact routes.",
    );
  assert.ok(
    same(live, prior) || same(live, next),
    "The catch-all changed outside this installation. Review the current route.",
  );
  const wanted = disconnect ? prior : next;
  const args = [...operations, "update", "--zone", zone, "--body", JSON.stringify(wanted)];
  if (!same(live, wanted)) cf([...args, "--dry-run"]);
  console.log(
    (disconnect ? "Restore the saved" : "Route unknown apex recipients to the") +
      " catch-all for " +
      domain +
      ".",
  );
  if (!apply) return;
  if (!record)
    query(
      "INSERT INTO apex_route_ownership(domain,worker,prior) VALUES(?,?,?) ON CONFLICT DO NOTHING",
      [domain, worker, JSON.stringify(prior)],
    );
  const [owned] = query("SELECT worker,prior FROM apex_route_ownership WHERE domain=?", [domain]);
  assert.ok(
    owned?.worker === worker && same(JSON.parse(owned.prior), prior),
    "Another installation owns the catch-all",
  );
  assert.ok(same(fields(current()), live), "Catch-all changed after preview");
  if (!same(live, wanted)) cf(args);
  assert.ok(same(fields(current()), wanted), "Catch-all readback did not match");
  if (disconnect)
    query("DELETE FROM apex_route_ownership WHERE domain=? AND worker=?", [domain, worker]);
  console.log("Verified the authoritative catch-all rule.");
}
