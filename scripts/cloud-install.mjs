import { transportHosts } from "./transport-hosts.mjs";
import { providerSecrets, providerBindings, uploadRelease } from "./provider-secrets.mjs";
import { protectMailboxBucket } from "./bucket-retention.mjs";
import { senderPlan, subscribe } from "./sending-domain.mjs";
import { oauthNamespace } from "./oauth-namespace.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { domainToASCII } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { cf, api } from "./cloud-cli.mjs";
import { installAccess, verifyInstall } from "./release/install.mjs";

const { values } = parseArgs({
  options: {
    check: { type: "boolean" },
    apply: { type: "boolean" },
    ai: { type: "boolean" },
    "disable-ai": { type: "boolean" },
    host: { type: "string" },
    owner: { type: "string" },
    sender: { type: "string" },
    identity: { type: "string", multiple: true },
    "remove-identity": { type: "string", multiple: true },
    "sending-mailbox": { type: "string" },
    jurisdiction: { type: "string" },
  },
});
assert.ok(Boolean(values.check) !== Boolean(values.apply), "Choose --check or --apply");
assert.ok(!(values.ai && values["disable-ai"]), "Choose one Workers AI setting");
const host = domainToASCII(values.host || "").toLowerCase();
assert.ok(
  !host.startsWith("mta-sts.") &&
    host.split(".").length >= 3 &&
    host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
  "Supply --host with an unused subdomain",
);
const content = host.replace(".", "-content.");
const owner = (values.owner || "").trim().toLowerCase();
assert.ok(
  /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(owner),
  "Supply --owner with the first administrator's sign-in email",
);
const jurisdiction = values.jurisdiction || "default";
assert.ok(
  ["default", "us", "eu", "fedramp"].includes(jurisdiction),
  "Choose a supported D1 jurisdiction",
);
const who = api("auth", "whoami");
assert.equal(who.accounts.length, 1, "Select the project's single-account Cloudflare profile");
const account = who.accounts[0].id;
const name =
  "edge-mail-" +
  createHash("sha256")
    .update(account + "/" + host)
    .digest("hex")
    .slice(0, 12);
const statePath = ".wrangler/instances/" + name + ".json";
const expected = { account, host, content, owner, name, jurisdiction };
const managed = existsSync(statePath);
if (managed)
  assert.deepEqual(
    JSON.parse(readFileSync(statePath, "utf8")),
    expected,
    "Installation parameters have changed",
  );
const bucket = name + "-receipts";
const team = api("zero-trust", "organization", "get").auth_domain;
assert.match(
  team,
  /^[a-z0-9-]+\.cloudflareaccess\.com$/,
  "Configure Cloudflare Zero Trust before installing",
);
function list(args, size = 50) {
  const found = [];
  for (let page = 1; ; page++) {
    const rows = api(...args, "--page", String(page), "--per-page", String(size));
    found.push(...rows);
    if (rows.length < size) return found;
  }
}
const zones = list(["zones", "list", "--account-id", account, "--status", "active"]).sort(
  (a, b) => b.name.length - a.name.length,
);
const zone = zones
  .filter((z) => host.endsWith("." + z.name))
  .sort((a, b) => b.name.length - a.name.length)[0];
assert.ok(zone?.account?.id === account, "Choose a subdomain of an active zone in this account");
const worker = list(["workers", "list"]).find((w) => w.name === name);
const db = api("d1", "list", "--name", name).find((d) => d.name === name);
const buckets = api("r2", "buckets", "list", "--name-contains", bucket);
const storage = (buckets.buckets || buckets).find((b) => b.name === bucket);
const queues = list(["queues", "list"]);
const queueNames = [name + "-ingest", name + "-ingest-dlq"];
if (!managed)
  assert.ok(
    !worker && !db && !storage && !queues.some((q) => queueNames.includes(q.queue_name)),
    "Resources already exist. Restore the original installation record before upgrading.",
  );
for (const hostname of [host, content]) {
  const records = api("dns", "records", "list", "--zone", zone.id, "--name", hostname);
  const domain = worker?.references?.domains?.find(
    (d) => d.hostname === hostname && d.zone_id === zone.id,
  );
  assert.ok(
    records.every((r) => domain && r.meta?.read_only && r.meta.origin_worker_id === domain.id),
    "Hostname already has DNS records owned by another service: " + hostname,
  );
}
const applications = list(["zero-trust", "access", "applications", "list"], 100);
const existing = applications.filter(
  (a) => a.domain === host || a.destinations?.some((d) => d.uri === host),
);
const title = "Edge Mail owner (" + host + ")";
assert.ok(
  existing.length <= 1 && (!existing.length || (managed && existing[0].name === title)),
  "Access hostname is already in use",
);
const access = existing[0];
if (access)
  assert.ok(
    access.policies.some(
      (p) => p.decision === "allow" && p.include.some((i) => i.email?.email === owner),
    ),
    "Existing Access policy does not allow the installation owner",
  );
function change(args, apply) {
  cf([...args, "--dry-run"]);
  if (!apply) return undefined;
  const output = cf(args).trim();
  return output ? JSON.parse(output) : undefined;
}
const accessArgs = [
  "zero-trust",
  "access",
  "applications",
  "create",
  "--body",
  JSON.stringify({
    type: "self_hosted",
    name: title,
    domain: host,
    app_launcher_visible: false,
    policies: [
      {
        name: "Installation owner",
        decision: "allow",
        include: [{ email: { email: owner } }],
        precedence: 1,
      },
    ],
  }),
];
const getVersion = () =>
  api("workers", "deployments", "list", "--worker", name, "--per-page", "1").deployments[0];
const current = worker && getVersion();
if (current)
  assert.equal(current.versions.length, 1, "Complete the current rollout before upgrading");
const bindings = current
  ? api("workers", "versions", "get", current.versions[0].version_id, "--worker", name).bindings
  : [];
const hasSecret = bindings.some((b) => b.name === "SETUP_TOKEN" && b.type === "secret_text");
const setup = process.env.SETUP_TOKEN;
if (values.apply && !hasSecret)
  assert.ok(
    setup && Buffer.byteLength(setup) >= 32,
    "Inject a SETUP_TOKEN of at least 32 bytes from your secret manager for the first installation",
  );
const from = values.sender ?? bindings.find((b) => b.name === "SEND_FROM")?.text ?? "";
const sendingMailbox =
  values["sending-mailbox"] ?? bindings.find((b) => b.name === "SEND_MAILBOX")?.text ?? "";
const stored = JSON.parse(bindings.find((b) => b.name === "SEND_IDENTITIES")?.text || "[]");
const extra = new Map(stored.map((v) => [v.from, v.mailbox]));
for (const value of values.identity || []) {
  const [sender, box, ...rest] = value.split("=");
  assert.ok(sender && box && !rest.length, "Use --identity sender@example.com=mailbox@example.com");
  extra.set(sender, box);
}
for (const value of values["remove-identity"] || []) extra.delete(value);
assert.ok(!extra.size || (from && sendingMailbox), "Supply the primary sender and mailbox");
assert.ok(
  extra.size <= 63 && !extra.has(from),
  "Keep up to 63 additional, unique sending addresses",
);
const plans = new Map();
const identities = [...extra].map(([sender, mailbox]) => ({ from: sender, mailbox }));
for (const value of [{ from, mailbox: sendingMailbox }, ...identities]) {
  const plan = senderPlan(zones, name, value.from, value.mailbox, queues);
  if (plan) plans.set(plan.source.domain, plan);
}
const sends = [...plans.values()];
if (sends.length) {
  const queue = name + "-events";
  queueNames.push(queue, queue + "-dlq");
  if (!managed)
    assert.ok(!queues.some((q) => queueNames.includes(q.queue_name)), "Queue name already in use");
}
const policyHosts = transportHosts(bucket, worker);
const providerInputs = Object.fromEntries(providerSecrets.map((key) => [key, process.env[key]]));
const env = {
  ...process.env,
  ...providerBindings(bindings, providerInputs),
  EDGE_ENABLE_AI:
    !values["disable-ai"] && (values.ai || bindings.some((b) => b.name === "AI" && b.type === "ai"))
      ? "yes"
      : "no",
  EDGE_INSTANCE_NAME: name,
  EDGE_OAUTH_KV: oauthNamespace(name, false, managed),
  EDGE_MAIL_ACCOUNT: account,
  EDGE_MAIL_HOST: host,
  EDGE_CONTENT_HOST: content,
  EDGE_TRANSPORT_HOSTS: policyHosts.join(","),
  ACCESS_TEAM_DOMAIN: team,
  ACCESS_AUD: access?.aud || "preview",
  EDGE_EVENT_SENDER: from,
  EDGE_SEND_FROM: from,
  EDGE_SEND_MAILBOX: sendingMailbox,
  EDGE_SEND_IDENTITIES: JSON.stringify(identities),
};
delete env.SETUP_TOKEN;
for (const key of providerSecrets) delete env[key];
const build = () => {
  cf(["deploy", "--mode", "self-host", "--dry-run"], { env, stdio: "inherit" });
  const preview = JSON.parse(
    readFileSync(".cloudflare/output/v1/workers/default/worker.config.json", "utf8"),
  );
  assert.equal(preview.name, name);
  assert.deepEqual(preview.domains, [host, ...policyHosts, content]);
  assert.equal(preview.workersDev, false);
};
const databaseArgs = [
  "d1",
  "create",
  "--name",
  name,
  ...(jurisdiction === "default" ? [] : ["--jurisdiction", jurisdiction]),
];
const bucketArgs = ["r2", "buckets", "create", "--name", bucket];
const queueArgs = queueNames
  .filter((n) => !queues.some((q) => q.queue_name === n))
  .map((queue_name) => ["queues", "create", "--body", JSON.stringify({ queue_name })]);
build();
if (!access) change(accessArgs, false);
if (!db) change(databaseArgs, false);
if (!storage) change(bucketArgs, false);
for (const args of queueArgs) change(args, false);
console.log(
  "Planned " +
    name +
    " at " +
    host +
    " with owner-only Access, D1 (" +
    jurisdiction +
    "), private R2, an ingest queue and its dead-letter queue.",
);
if (values.apply) {
  for (const gate of ["deploy:check", "test:e2e", "size", "secrets"])
    execFileSync("pnpm", [gate], { env, stdio: "inherit" });
  if (!managed) {
    mkdirSync(".wrangler/instances", { recursive: true });
    writeFileSync(statePath, JSON.stringify(expected, null, 2), { flag: "wx", mode: 0o600 });
  }
  env.EDGE_OAUTH_KV = oauthNamespace(name, true, managed);
  const app = access || change(accessArgs, true);
  env.ACCESS_AUD = app.aud;
  assert.ok(app.aud);
  installAccess({ host, stage: name }, true);
  const database = db || change(databaseArgs, true);
  if (!storage) change(bucketArgs, true);
  protectMailboxBucket(bucket, true);
  for (const plan of sends) await plan.apply();
  for (const args of queueArgs) change(args, true);
  if (current)
    console.log(
      "Previous Worker version " +
        current.versions[0].version_id +
        ", D1 bookmark " +
        api("d1", "time-travel", "get-bookmark", database.uuid).bookmark,
    );
  const migrations = ["d1", "migrations", "apply", database.uuid, "--dir", "migrations"];
  cf([...migrations, "--dry-run"]);
  cf(migrations);
  build();
  const deploy = ["deploy", "--prebuilt", "--mode", "self-host"];
  uploadRelease(deploy, env, { ...providerInputs, ...(hasSecret ? {} : { SETUP_TOKEN: setup }) });
  execFileSync("node", ["scripts/domain-catalog.mjs", "--apply", name], { env, stdio: "inherit" });
  for (const plan of sends) subscribe(plan.source, plan.queueName);
  await verifyInstall({ host });
  const deadline = Date.now() + 90000;
  for (;;) {
    try {
      const gate = await fetch("https://" + host + "/setup", {
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      assert.equal(new URL(gate.headers.get("location")).hostname, team);
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await sleep(2500);
    }
  }
  console.log(
    "Installed " +
      name +
      ". Sign in at https://" +
      host +
      "/setup and enter your setup token. Save " +
      statePath +
      " with your deployment records.",
  );
}
