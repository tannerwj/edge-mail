import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { activeBindings, api, cf, pages } from "./cloud-cli.mjs";
import { transportHost, validDomain } from "./transport-hosts.mjs";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    check: { type: "boolean" },
    apply: { type: "boolean" },
    publish: { type: "boolean" },
    policy: { type: "string", default: "testing" },
    report: { type: "string" },
  },
});
const [domain, worker] = positionals;
assert.ok(
  positionals.length === 2 &&
    validDomain(domain) &&
    /^[a-z0-9-]+$/.test(worker) &&
    Boolean(values.check) !== Boolean(values.apply) &&
    ["none", "testing", "enforce"].includes(values.policy),
  "Choose --check or --apply, an optional --policy testing|enforce|none, and a mail domain and installed Worker",
);
assert.equal(api("auth", "whoami").accounts.length, 1, "Select a single-account profile");
const info = transportHost(domain, api("workers", "get", worker));
const bindings = activeBindings(worker),
  bucket = bindings.find((b) => b.name === "MAIL" && b.type === "r2_bucket")?.bucket_name;
assert.ok(bucket, "Missing Edge Mail bucket");
const zone = ["--zone", info.zone.id];
const records = (name) => pages(["dns", "records", "list", ...zone, "--name", name]);
const mx = [
  ...new Set(
    records(domain)
      .filter((r) => r.type === "MX")
      .map((r) => r.content.toLowerCase().replace(/\.$/, "")),
  ),
].sort((a, b) => a.localeCompare(b));
assert.ok(
  values.policy === "none" || (mx.length && mx.every(validDomain)),
  "Testing and enforcement require explicit, valid MX hosts",
);
const policy = [
  "version: STSv1",
  "mode: " + values.policy,
  ...(values.policy === "none" ? [] : mx.map((v) => "mx: " + v)),
  "max_age: " + (values.policy === "none" ? 0 : 86400),
  "",
].join("\r\n");
console.log(policy.trimEnd());
const id = createHash("sha256").update(policy).digest("hex").slice(0, 24);
const key = "instance/transport/" + domain + ".txt",
  url = "https://" + info.hostname + "/.well-known/mta-sts.txt";
const comment = "Edge Mail transport " + worker;
function dns(name, content) {
  const previous = records(name);
  const tag = content.split(";")[0].toLowerCase();
  assert.ok(!previous.some((r) => r.type === "CNAME"), "Existing CNAME controls the policy");
  const matches = previous.filter(
    (r) => r.type === "TXT" && r.content.replaceAll('"', "").toLowerCase().startsWith(tag),
  );
  assert.ok(
    matches.length <= 1 && matches.every((r) => r.comment === comment),
    "Foreign transport policy exists",
  );
  if (matches[0]?.content.replaceAll('"', "") === content) return null;
  return [
    "dns",
    "records",
    ...(matches.length ? ["update", matches[0].id] : ["create"]),
    ...zone,
    "--body",
    JSON.stringify({ type: "TXT", name, content, ttl: 300, comment }),
  ];
}
const writes = [dns("_mta-sts." + domain, "v=STSv1; id=" + id)];
if (values.report) {
  const [local, host, ...rest] = values.report.split("@");
  assert.ok(
    /^[a-z0-9][a-z0-9._+-]{0,63}$/.test(local) && host === domain && !rest.length,
    "Choose a reporting mailbox on the policy domain",
  );
  const db = bindings.find((b) => b.type === "d1" && b.name === "DB").database_id;
  const sql =
    "SELECT a.canonical FROM addresses a JOIN mailboxes b ON a.mailbox_id=b.id WHERE a.canonical=? LIMIT 1";
  assert.ok(
    api("d1", "query", db, "--body", JSON.stringify({ sql, params: [values.report] }))[0].results
      .length,
    "Create the TLS reporting mailbox first",
  );
  writes.push(dns("_smtp._tls." + domain, "v=TLSRPTv1; rua=mailto:" + values.report));
}
for (const args of writes.filter(Boolean)) cf([...args, "--dry-run"]);
if (values.publish) {
  assert.ok(info.bound, "Deploy the installation with the prepared policy hostname first");
  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
  assert.ok(
    res.ok &&
      res.headers.get("content-type")?.startsWith("text/plain") &&
      (await res.text()) === policy,
    "Public HTTPS policy did not match the planned MX hosts and mode",
  );
  if (values.apply) for (const args of writes.filter(Boolean)) cf(args);
  console.log(
    "Verified HTTPS policy; " +
      (values.apply ? "published" : "previewed") +
      " " +
      writes.filter(Boolean).length +
      " DNS changes.",
  );
} else {
  const put = [
    "r2",
    "objects",
    "put",
    key,
    "--bucket-name",
    bucket,
    "--body",
    policy,
    "--content-type",
    "text/plain",
  ];
  cf([...put, "--dry-run"]);
  if (values.apply) cf(put);
  console.log(
    (values.apply ? "Prepared" : "Previewed") +
      " " +
      url +
      ". Run the normal deployment, then repeat with --publish to verify HTTPS and advertise the policy.",
  );
}
