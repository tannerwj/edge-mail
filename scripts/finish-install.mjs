import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { activeBindings, api, pages } from "./cloud-cli.mjs";
import { protectMailboxBucket } from "./bucket-retention.mjs";
import { installAccess, verifyInstall } from "./release/install.mjs";

const [mode, worker, ...extra] = process.argv.slice(2);
assert.ok(
  ["--check", "--apply"].includes(mode) && !extra.length && /^[a-z0-9-]+$/.test(worker || ""),
  "Use pnpm install:finish --check or --apply followed by the Worker name",
);
assert.equal(api("auth", "whoami").accounts.length, 1, "Select the installation account");
const bindings = activeBindings(worker);
const binding = (name, type) => bindings.find((b) => b.name === name && b.type === type);
const bucket = binding("MAIL", "r2_bucket")?.bucket_name;
const audience = binding("ACCESS_AUD", "plain_text")?.text;
const origin = binding("CONTENT_ORIGIN", "plain_text")?.text;
assert.ok(
  bucket && audience && origin && binding("DB", "d1") && binding("SETUP_TOKEN", "secret_text"),
  "Configure the installed Edge Mail Worker, Access variables and content hostname first",
);
const content = new URL(origin);
assert.equal(content.origin, origin);
assert.equal(content.protocol, "https:");
const apps = pages(["zero-trust", "access", "applications", "list"], 100);
const app = apps.find((a) => a.aud === audience && a.type === "self_hosted");
const host = app?.domain;
const domains = api("workers", "get", worker).references?.domains || [];
assert.ok(
  host &&
    host !== content.hostname &&
    [host, content.hostname].every((h) => domains.some((d) => d.hostname === h)),
  "The Access application and both custom domains must belong to this installation",
);
const apply = mode === "--apply";
installAccess({ host, stage: worker }, apply);
protectMailboxBucket(bucket, apply);
execFileSync(process.execPath, ["scripts/domain-catalog.mjs", mode, worker], { stdio: "inherit" });
if (apply) await verifyInstall({ host });
console.log(
  (apply ? "Verified" : "Previewed") +
    " install paths, 35-day retention and domain discovery for " +
    host,
);
