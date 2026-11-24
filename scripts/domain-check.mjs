import assert from "node:assert/strict";
import { resolveNs, resolve4, resolve6 } from "node:dns/promises";
import { domainToASCII } from "node:url";
import { api, pages as all } from "./cloud-cli.mjs";

const host = domainToASCII(process.argv[2] || "").toLowerCase();
assert.ok(
  process.argv.length === 3 &&
    host.includes(".") &&
    host.length <= 253 &&
    host.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)),
  "Provide one mail domain",
);
const login = api("auth", "whoami");
assert.equal(login.accounts.length, 1, "Select a CLI profile for a single Cloudflare account");
const account = login.accounts[0].id;
function findZone() {
  const labels = host.split(".");
  while (labels.length > 1) {
    const name = labels.join(".");
    const [zone] = api("zones", "list", "--name", name);
    if (zone) {
      assert.ok(
        zone.name === name && zone.status === "active" && zone.account?.id === account,
        "Zone is not active in the selected account",
      );
      return zone;
    }
    labels.shift();
  }
  throw Error("No authoritative Cloudflare zone for this domain in the selected account");
}
const zone = findZone(),
  z = ["--zone", zone.id],
  apex = host === zone.name;
const records = (name) => all(["dns", "records", "list", ...z, "--name", name]);
const clean = (s) => s.replace(/"\s+"/g, "").replaceAll('"', "");
const at = records(host),
  policy = records("_dmarc." + host).filter(
    (r) => r.type === "TXT" && clean(r.content).startsWith("v=DMARC1"),
  );
const mx = at
  .filter((r) => r.type === "MX")
  .map((r) => ({
    server: r.content.replace(/\.$/, "").toLowerCase(),
    priority: r.priority,
    ttl: r.ttl,
  }));
const nullMX = mx.length === 1 && mx[0].priority === 0 && mx[0].server === "";
const foreign = !nullMX && mx.some((r) => !/^route[0-9]+\.mx\.cloudflare\.net$/.test(r.server));
async function addressesFor(resolve) {
  try {
    return await resolve(host);
  } catch (error) {
    if (["ENODATA", "ENOTFOUND"].includes(error.code)) return [];
    throw error;
  }
}
const [nameservers, ip4, ip6] = await Promise.all([
  resolveNs(zone.name),
  addressesFor(resolve4),
  addressesFor(resolve6),
]);
const delegated =
  nameservers.length > 0 && nameservers.every((ns) => zone.name_servers.includes(ns.toLowerCase()));
const implicit =
  !mx.length &&
  (ip4.length > 0 || ip6.length > 0 || at.some((r) => ["A", "AAAA", "CNAME"].includes(r.type)));
const sending = api("email-sending", "subdomains", "list", ...z);
const identity = sending.find((s) => s.name === host);
const rules = all(["email-routing", "rules", "list-account", ...z]);
const exact = rules.filter(
  (r) =>
    r.enabled &&
    r.matchers.some(
      (m) =>
        m.field === "to" && m.type === "literal" && m.value?.toLowerCase().endsWith("@" + host),
    ),
);
const subs = all(["queues", "subscriptions", "list"]).filter(
  (s) =>
    s.source?.type === "email.sending" &&
    s.source?.zone_id === zone.id &&
    s.source?.domain === host,
);
const addresses = at
  .filter((r) => r.type === "TXT" && clean(r.content).startsWith("v=spf1"))
  .map((r) => clean(r.content));
const selector = identity?.dkim_selector;
const dkim = selector
  ? records(selector + "._domainkey." + host)
      .filter((r) => ["TXT", "CNAME"].includes(r.type))
      .map((r) => r.type)
  : [];
const guidance = [];
if (!policy.length)
  guidance.push(
    "Review existing senders and the parent DMARC policy before enabling Sending. Cloudflare onboarding may create p=reject. Decide on a reporting policy and a monitored rua mailbox first.",
  );
if (!delegated)
  guidance.push(
    "Verify the registrar delegation before changing mail DNS. Public nameservers differ from those in this account.",
  );
if (nullMX)
  guidance.push(
    "This domain publishes a null MX and explicitly declines mail. Plan and verify mailbox activation before replacing that record.",
  );
else if (foreign || implicit)
  guidance.push(
    "Stop before changing MX. Inventory the receiving provider and its TTLs, keep both inboxes available, and follow the cutover and rollback procedure in DEPLOY.md.",
  );
else if (mx.length)
  guidance.push(
    "Mail already routes to Cloudflare. Review existing rules and their owners before changing how any recipient is handled.",
  );
else
  guidance.push(
    "No explicit or implicit mail host is configured. Create the domain, mailbox and grants in Edge Mail Settings before enabling Routing.",
  );
if (apex)
  guidance.push(
    "For a dedicated apex use one catch-all Worker rule and define the unknown-recipient policy. Preserve existing shared-zone catch-all rules, and use exact-address routing on a shared apex.",
  );
else
  guidance.push(
    "Create one literal Worker rule per address on this subdomain. Track the 200-rule limit and enable subaddressing.",
  );
guidance.push(
  "Create postmaster@, abuse@ and a DMARC reporting address. Verify an external message before directing real traffic here.",
);
if (!identity)
  guidance.push(
    "Preview the proposed Sending DNS with pnpm exec cf email-sending subdomains preview --zone " +
      zone.name +
      " --name " +
      host +
      ". Compare the proposed SPF, DKIM and DMARC with the records below.",
  );
if (!subs.length)
  guidance.push(
    "When outbound sending is enabled, subscribe this sending domain to its intended event queue. The provider allows one subscription for the resource.",
  );
console.log(
  JSON.stringify(
    {
      domain: host,
      zone: zone.name,
      nameservers: zone.name_servers,
      observedNameservers: nameservers,
      delegated,
      receivingMode: apex ? "apex" : "subdomain",
      guidance,
      mx,
      implicit,
      nullMX,
      spf: addresses,
      dmarc: policy.map((r) => clean(r.content)),
      sendingDomainsInZone: sending.length,
      sending: identity
        ? {
            enabled: identity.enabled,
            returnPathDomain: identity.return_path_domain,
            selector,
            dkimRecordTypes: dkim,
          }
        : null,
      activeLiteralRules: exact.length,
      activeCatchAllRules: rules.filter(
        (r) => r.enabled && r.matchers.some((m) => m.type === "all"),
      ).length,
      eventSubscriptions: subs.map((s) => ({ name: s.name, enabled: s.enabled })),
    },
    null,
    2,
  ),
);
