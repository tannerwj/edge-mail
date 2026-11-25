import { recordRoutes } from "./route-status.mjs";
import { apexRoute } from "./domain-catch-all.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { domainToASCII } from "node:url";
import { parseArgs } from "node:util";
import { activeBindings, api, cf, pages } from "./cloud-cli.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    check: { type: "boolean" },
    apply: { type: "boolean" },
    disconnect: { type: "boolean" },
    only: { type: "string" },
    "catch-all": { type: "boolean" },
  },
});
const [domain, worker] = positionals;
assert.ok(
  positionals.length === 2 &&
    Boolean(values.check) !== Boolean(values.apply) &&
    /^[a-z0-9-]+$/.test(worker) &&
    domainToASCII(domain) === domain &&
    domain.split(".").length > 1 &&
    domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
  "Use pnpm domain:connect --check or --apply followed by the domain and Worker name",
);
const report = JSON.parse(
  execFileSync(process.execPath, ["scripts/domain-check.mjs", domain], { encoding: "utf8" }),
);
assert.ok(report.delegated, "Check nameserver delegation before routing mail");
const zone = ["--zone", report.zone];
for (let name = domain; name !== report.zone; name = name.split(".").slice(1).join(".")) {
  assert.ok(name.endsWith("." + report.zone), "Cloudflare did not return the parent zone");
  assert.equal(
    pages(["dns", "records", "list", ...zone, "--name", name, "--type", "NS"]).length,
    0,
    "A child nameserver delegation controls this mail domain",
  );
}
const bindings = activeBindings(worker);
assert.ok(
  bindings.some((b) => b.type === "r2_bucket" && b.name === "MAIL"),
  "Select the installed Edge Mail Worker",
);
const bucket = bindings.find((b) => b.type === "r2_bucket" && b.name === "MAIL").bucket_name;
const db = bindings.find((b) => b.type === "d1" && b.name === "DB").database_id;
const sql =
  "SELECT a.canonical FROM (SELECT canonical,mailbox_id FROM addresses UNION ALL SELECT canonical,mailbox_id FROM temporary_addresses WHERE (?4 OR (disabled=0 AND (expires IS NULL OR expires>unixepoch()*1000)))) a JOIN mailboxes b ON b.id=a.mailbox_id JOIN domains d ON d.id=b.domain_id WHERE d.name=?1 AND (?2 IS NULL OR a.canonical=?3) ORDER BY a.canonical LIMIT 201";
const params = [
  domain,
  values.only?.toLowerCase() || null,
  values.only?.toLowerCase() || null,
  Number(!!values.disconnect),
];
const addresses = api("d1", "query", db, "--body", JSON.stringify({ sql, params }))[0].results.map(
  (r) => r.canonical,
);
assert.ok(
  values["catch-all"] || addresses.length,
  "Create the mailbox or alias in Settings before connecting routing",
);
assert.ok(
  values["catch-all"] || addresses.length <= 200,
  "Choose an individual address with --only",
);
const rules = () => pages(["email-routing", "rules", "list-account", ...zone]);
const before = rules();
const label = (address) =>
  "Edge Mail " +
  createHash("sha256")
    .update(worker + "\0" + address)
    .digest("hex")
    .slice(0, 24);
function matches(rule, address) {
  return rule.matchers.some(
    (m) => m.field === "to" && m.type === "literal" && m.value.toLowerCase() === address,
  );
}
function compatible(rule) {
  return (
    rule.enabled &&
    rule.matchers.length === 1 &&
    rule.actions.length === 1 &&
    rule.actions[0].type === "worker" &&
    rule.actions[0].value?.length === 1 &&
    rule.actions[0].value[0] === worker
  );
}
function route(address, existing) {
  const found = existing.filter((r) => matches(r, address));
  assert.ok(found.length <= 1, "Competing rules already use " + address);
  const rule = found[0];
  if (values.disconnect) {
    if (rule?.name !== label(address)) return null;
    assert.ok(
      compatible(rule),
      "An operator changed the rule for " + address + "; review it manually",
    );
    return ["email-routing", "rules", "delete", rule.id || rule.tag, ...zone, "--force"];
  }
  if (rule) {
    assert.ok(compatible(rule), "An existing routing rule owns " + address);
    return null;
  }
  const body = {
    name: label(address),
    enabled: true,
    matchers: [{ type: "literal", field: "to", value: address }],
    actions: [{ type: "worker", value: [worker] }],
  };
  return ["email-routing", "rules", "create", ...zone, "--body", JSON.stringify(body)];
}
function activation() {
  if (values.disconnect) return null;
  assert.ok(
    !report.implicit &&
      !report.nullMX &&
      report.mx.every((r) => /^route\d+\.mx\.cloudflare\.net$/.test(r.server)),
    "This domain already has a mail destination. Follow the MX cutover procedure first.",
  );
  if (report.mx.length) return null;
  assert.ok(!report.spf.length, "Review the existing SPF policy before enabling Routing");
  const active = before.filter((r) => r.enabled);
  assert.ok(
    !active.some((r) =>
      r.matchers.some((m) => m.type === "all" || m.value?.endsWith("@" + domain)),
    ),
    "Review existing enabled rules before activating this domain",
  );
  return ["email-routing", "enable", ...zone, "--name", domain];
}
const enable = activation();
if (values["catch-all"]) {
  assert.ok(!values.only && domain === report.zone, "Catch-all requires an entire apex zone");
  if (enable) {
    cf([...enable, "--dry-run"]);
    if (!values.apply) {
      console.log(
        "Enable Routing DNS, then inspect the default catch-all before connecting it to the Worker.",
      );
      process.exit(0);
    }
    mkdirSync(".wrangler/routes", { recursive: true });
    writeFileSync(
      ".wrangler/routes/" + domain + "-" + Date.now() + ".json",
      JSON.stringify({ records: pages(["dns", "records", "list", ...zone]), rules: before }),
      { flag: "wx", mode: 0o600 },
    );
    cf(enable);
  }
  apexRoute({
    domain,
    zone: report.zone,
    worker,
    db,
    disconnect: !!values.disconnect,
    apply: !!values.apply,
  });
  if (values.apply) recordRoutes(bucket, domain, "apex", values.disconnect ? [] : ["*"]);
  process.exit(0);
}
const plan = addresses.map((a) => route(a, before)).filter(Boolean);
if (!values.disconnect)
  assert.ok(
    before.filter((r) => !r.matchers.some((m) => m.type === "all")).length + plan.length <= 200,
    "The zone routing-rule limit would be exceeded",
  );
if (enable) cf([...enable, "--dry-run"]);
for (const args of plan) cf([...args, "--dry-run"]);
console.log(
  JSON.stringify({
    domain,
    worker,
    addresses: addresses.length,
    ruleChanges: plan.length,
    activateDNS: !!enable,
    disconnect: !!values.disconnect,
  }),
);
if (values.apply) {
  if (enable) {
    mkdirSync(".wrangler/routes", { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const records = pages(["dns", "records", "list", ...zone]);
    writeFileSync(
      ".wrangler/routes/" + domain + "-" + stamp + ".json",
      JSON.stringify({ domain, zone: report.zone, records, rules: before }),
      { flag: "wx", mode: 0o600 },
    );
    cf(enable);
  }
  for (const address of addresses) {
    const action = route(address, rules());
    if (action) cf(action);
  }
  const after = rules();
  for (const address of addresses)
    assert.equal(route(address, after), null, "Routing did not converge for " + address);
  recordRoutes(
    bucket,
    domain,
    "exact",
    after
      .filter(compatible)
      .flatMap((r) =>
        r.matchers
          .filter(
            (m) => m.type === "literal" && m.field === "to" && m.value?.endsWith("@" + domain),
          )
          .map((m) => m.value),
      ),
  );
  console.log("Verified exact routing for " + addresses.length + " configured addresses.");
}
