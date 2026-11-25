import { checkInboundQuota } from "./inbound-quota.mjs";
import { checkPersonErasure } from "./person-erasure.mjs";
import { checkAssistance } from "./assistance.mjs";
import { checkReports } from "./report-dashboard.mjs";
import { checkOperatingLimits } from "./operating-limits.mjs";
import { checkDisposable } from "./disposable.mjs";
import { checkLibrary } from "./composer-library.mjs";
import { checkGrantLimits } from "./grant-limits.mjs";
import { checkReminders } from "./reminders.mjs";
import { checkInvitations } from "./invitations.mjs";
import { checkHookForm } from "./hook-ui.mjs";
import { checkErasure } from "./erasure.mjs";
import { checkRichCompose } from "./rich-compose.mjs";
import { checkIdentity } from "./identity.mjs";
import { checkPortability } from "./portability.mjs";
import { checkOAuth } from "./oauth.mjs";
import { checkVacation } from "./vacation.mjs";
import { checkScreening } from "./screening.mjs";
import { checkAgents } from "./agents.mjs";
import { checkForward } from "./forward.mjs";
import { checkRules } from "./rules.mjs";
import { checkOffboard } from "./people.mjs";
import { checkDomainImport } from "./domain-import.mjs";
import { checkAttachments } from "./attachments.mjs";
import { checkLive } from "./live.mjs";
import { checkOffline } from "./offline.mjs";
import { checkSnapshot } from "./snapshot.mjs";
import { checkOutbox } from "./outbox.mjs";
import { checkDrafts } from "./drafts.mjs";
import { checkConversations } from "./conversations.mjs";
import { addFirstDomain, checkSharedReader, addManagedMailbox } from "./mail-personas.mjs";
import { checkTriage } from "./triage.mjs";
import { checkLimits, checkHtml } from "./limits.mjs";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { mailFixture } from "./mail-fixture.mjs";
const { origin, token, wrangler, sql, start, state, request, json, close } = await mailFixture();
let browser, pushProfile;
async function mail(to, trace = "one") {
  const raw = [
    "Authentication-Results: mx.cloudflare.net; spf=fail",
    "Authentication-Results: forged.test; spf=pass",
    "Received: " + trace,
    "From: Customer <customer@outside.test>",
    "To: undisclosed-recipients:;",
    "Cc: billing@outside.test",
    "Message-ID: <fixture@outside.test>",
    "Subject: Delivery question",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Please confirm the delivery window.",
    "",
  ].join("\r\n");
  const r = await fetch(
    origin + "/cdn-cgi/local/email?" + new URLSearchParams({ from: "customer@outside.test", to }),
    { method: "POST", body: raw },
  );
  assert.ok(r.ok, "email simulator returned " + r.status + " " + (await r.text()));
}
try {
  wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state]);
  await start();
  const locked = await fetch(origin + "/app", {
    headers: { "Cf-Access-Authenticated-User-Email": "owner@example.test" },
  });
  assert.equal(locked.status, 503);
  assert.equal(locked.headers.get("X-Frame-Options"), "DENY");
  const install = await (await request("/install/manifest.webmanifest")).json();
  assert.equal(install.start_url, "/app");
  for (const icon of install.icons) {
    const png = await request(icon.src);
    assert.equal(Buffer.from(await png.arrayBuffer()).readUInt32BE(0), 0x89504e47);
  }
  assert.equal((await request("/install/private")).status, 503);
  await start("owner@example.test");
  assert.equal((await request("/api/domains", { name: "mail.test" })).status, 403);
  assert.equal((await request("/api/setup", { token: "incorrect" })).status, 403);
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined),
  });
  if (process.env.EDGE_MAIL_NATIVE_PUSH === "1") {
    pushProfile = await chromium.launchPersistentContext(join(state, "push-browser"), {
      executablePath: process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined),
      ignoreDefaultArgs: ["--disable-background-networking"],
    });
  }
  const page = pushProfile ? await pushProfile.newPage() : await browser.newPage();
  await page.goto(origin + "/setup");
  await page.getByLabel("Setup token").fill(token);
  await page.getByRole("button", { name: "Create owner" }).click();
  await page.getByRole("heading", { name: "No mailboxes yet" }).waitFor();
  assert.equal((await request("/api/setup", { token })).status, 410);
  const completed = await page.goto(origin + "/setup");
  assert.equal(completed.status(), 410);
  await page.getByRole("link", { name: "Open your inbox" }).click();
  await page.getByRole("heading", { name: "No mailboxes yet" }).waitFor();
  const foreign = await fetch(origin + "/api/domains", {
    method: "POST",
    headers: { Origin: "https://other.test", "Content-Type": "application/json" },
    body: '{"name":"foreign.test"}',
  });
  assert.equal(foreign.status, 403);
  for (const path of ["builder", "raw"]) {
    const probe = await json("/api/provider-probe", { path });
    assert.equal(probe.state, "captured");
    assert.equal(probe.supplied_wire_id === null, path === "builder");
    assert.deepEqual(await json("/api/provider-probe", { path }), probe);
  }
  const domain = await addFirstDomain(page);
  const { id: box } = await json("/api/mailboxes", {
    name: "Support",
    address: "support@mail.test",
  });
  const { id: privateBox } = await json("/api/mailboxes", {
    name: "Private",
    address: "private@mail.test",
  });
  for (const alias of ["help", "orders"])
    await json("/api/mailboxes/" + box + "/aliases", { address: alias + "@mail.test" });
  await json("/api/users", { email: "reader@example.test" });
  await json("/api/mailboxes/" + box + "/members", {
    email: "reader@example.test",
    role: "reader",
  });
  await json("/api/users", { email: "admin@example.test", role: "admin" });
  await json("/api/users", { email: "manager@example.test" });
  await json("/api/domains/" + domain + "/admins", { email: "manager@example.test" });
  for (const role of ["owner", "editor"]) {
    const email = "box-" + role + "@example.test";
    await json("/api/users", { email });
    await json("/api/mailboxes/" + box + "/members", { email, role });
  }
  const list = "/api/mailboxes/" + box + "/messages";
  await start("owner@example.test", true);
  await mail("HELP+order@mail.test");
  assert.equal((await json(list)).messages.length, 0);
  assert.equal(sql("SELECT count(*) AS n FROM ingest_failures")[0].n, 0);
  assert.deepEqual(await json("/test/jobs"), [403, 403, 403]);
  await start("owner@example.test");
  const cron = await fetch(origin + "/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*");
  assert.ok(cron.ok, "cron " + cron.status);
  for (let i = 0; i < 80 && !(await json(list)).messages.length; i++) await sleep(200);
  const [message] = (await json(list)).messages;
  assert.ok(message, "Bcc receipt was not recovered");
  const detail = list + "/" + message.id;
  const first = await json(detail);
  assert.equal(first.deliveries[0].envelope_to, "HELP+order@mail.test");
  assert.equal(first.deliveries[0].plus_tag, "order");
  assert.deepEqual(JSON.parse(first.deliveries[0].auth), { spf: "fail" });
  await mail("orders@mail.test", "two");
  for (let i = 0; i < 80 && (await json(detail)).deliveries.length < 2; i++) await sleep(200);
  assert.equal((await json(detail)).deliveries.length, 2);
  assert.equal((await json(list)).messages.length, 1);
  await start("owner@example.test", true);
  assert.equal((await json("/test/replay")).replayed, 2);
  assert.equal(sql("SELECT count(*) AS n FROM search_fts")[0].n, 1);
  await start("owner@example.test");
  await checkLimits(origin, "/api/mailboxes/" + privateBox + "/messages", json);
  await checkHtml(origin, "/api/mailboxes/" + privateBox + "/messages", json);
  await start("reader@example.test");
  assert.equal((await request("/api/domains/" + domain + "/dns")).status, 403);
  assert.equal((await request("/api/operations")).status, 403);
  assert.equal((await json("/api/workspace")).mailboxes.length, 1);
  assert.equal(
    (await request("/api/mailboxes/" + privateBox + "/messages/" + message.id)).status,
    404,
  );
  assert.equal(
    (await request("/api/mailboxes/" + box + "/aliases", { address: "extra@mail.test" })).status,
    403,
  );
  await checkSharedReader(page, origin, box, privateBox);
  await checkTriage({ json, request, start, list, detail, privateBox, page, origin, box });
  await checkConversations({ origin, list, json, page, box, root: message.id });
  await checkDrafts({ page, box, origin, root: message.id, json, start, request });
  await checkOutbox({ origin, page, json, request, box, start, sql });
  await checkAttachments({ start, json, origin, box, sql, browser });
  await checkSnapshot({ start, json, sql, box, root: message.id, list });
  await start("owner@example.test");
  await page.goto(origin + "/settings/operations");
  await page.getByText("Instance operations", { exact: true }).click();
  await page.getByText("Latest completed backup", { exact: true }).waitFor();
  const ops = await json("/api/operations");
  assert.equal(ops.schemaReady, true);
  assert.deepEqual(await json("/healthz"), { ready: true });
  // Simulate a Worker upgrade that skipped its D1 migration.
  const latest = sql("SELECT id,name FROM d1_migrations ORDER BY id DESC LIMIT 1")[0];
  sql("UPDATE d1_migrations SET name='skipped' WHERE id=" + latest.id);
  try {
    const unready = await request("/healthz");
    assert.equal(unready.status, 503);
    assert.deepEqual(await unready.json(), { ready: false });
    const report = await json("/api/operations");
    assert.equal(report.schemaReady, false);
    assert.equal(report.activity, null);
  } finally {
    sql("UPDATE d1_migrations SET name='" + latest.name + "' WHERE id=" + latest.id);
  }
  assert.ok(ops.databaseBytes > 0 && Date.parse(ops.activity.lastBackup) > 0);
  assert.equal(ops.activity.uncertain, 1);
  await checkOffline({ browser, origin, start, box, sql, json });
  await checkLive({ browser, start, json, origin, box, privateBox, sql });
  await start("manager@example.test");
  assert.equal((await request("/api/operations")).status, 403);
  assert.equal((await request(list)).status, 404);
  assert.equal((await json("/api/workspace")).managed.length, 2);
  await addManagedMailbox(page, origin);
  assert.ok((await json("/api/workspace")).managed.some((m) => m.address === "returns@mail.test"));
  assert.equal((await request("/api/domains", { name: "blocked.test" })).status, 403);
  await start("box-owner@example.test");
  await json("/api/mailboxes/" + box + "/members", {
    email: "reader@example.test",
    role: "reader",
  });
  await start("box-editor@example.test");
  assert.equal((await request(detail)).status, 200);
  assert.equal(
    (
      await request("/api/mailboxes/" + box + "/members", {
        email: "reader@example.test",
        role: "owner",
      })
    ).status,
    403,
  );
  await start("admin@example.test");
  assert.equal((await request(detail)).status, 200);
  assert.equal(
    (await request("/api/users", { email: "another@example.test", role: "owner" })).status,
    403,
  );
  await checkRichCompose({ page, box, origin, json, start, sql });
  await checkIdentity({ page, start, origin, json, request, box, sql });
  await checkDomainImport({ page, origin, request, json, start, state, wrangler });
  await checkRules({ page, origin, json, request, start, box, privateBox });
  await checkForward({ page, start, origin, box, json, request, sql });
  await checkVacation({ origin, box, start, json, request, wrangler, state, sql });
  await checkScreening({ page, origin, start, box, json, request, sql });
  await checkAgents({ page, origin, start, box, privateBox, root: message.id, json, sql });
  await checkOAuth({ origin, page, start, box });
  await checkPortability({ page, origin, start, json, request, sql });
  await checkReminders({ origin, page, start, box, root: message.id, json, request, sql });
  await checkLibrary({ start, page, origin, box, json, request });
  await checkDisposable({ start, page, origin, box, json, request, sql });
  await checkInvitations({ origin, start, page, json, request, box, sql });
  await checkGrantLimits({ page, origin, start, box, json, request, sql });
  await checkAssistance({ start, request, json, page, box, origin, privateBox, detail, sql });
  await checkReports({ start, json, request, page, origin, box });
  await checkOperatingLimits({ page, origin, start, box, json, request, sql });
  await checkHookForm({ page, start, origin, box });
  await checkErasure({ page, start, origin, box, json, request, sql, wrangler, state });
  await checkPersonErasure({ start, request, json, page, origin, box, sql });
  await checkInboundQuota({ origin, page, start, json, request, sql });
  await checkOffboard({ page, origin, request, json, start, sql, box });
  await start("unknown@example.test");
  assert.equal((await request(detail)).status, 403);
  console.log(
    "PASS · setup, Access fail-closed, origin guard, streamed Bcc recovery, alias deduplication, replay, FTS cardinality, service scope, mailbox isolation, desktop and mobile reader",
  );
} finally {
  await pushProfile?.close();
  await browser?.close();
  await close();
}
