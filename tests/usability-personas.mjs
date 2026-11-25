import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { mailFixture } from "./mail-fixture.mjs";
const { origin, token, wrangler, state, start, json, request, close } = await mailFixture();
let browser;
async function deliver(to, subject) {
  const lines = [
    "From: Casey <casey@vendor.test>",
    "To: " + to,
    "Cc: alex@vendor.test",
    "Message-ID: <" + crypto.randomUUID() + "@vendor.test>",
    "Subject: " + subject,
    "Content-Type: multipart/mixed; boundary=parts",
    "",
    "--parts",
    "Content-Type: text/plain",
    "",
    "Tuesday pickup confirmed.",
    "--parts",
    'Content-Type: text/plain; name="pickup.txt"',
    'Content-Disposition: attachment; filename="pickup.txt"',
    "",
    "Desk four",
    "--parts--",
  ];
  const r = await fetch(
    origin + "/cdn-cgi/local/email?" + new URLSearchParams({ from: "casey@vendor.test", to }),
    { method: "POST", body: lines.join("\r\n") },
  );
  assert.ok(r.ok);
}
try {
  wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state]);
  await start("owner@example.test");
  await json("/api/setup", { token });
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const role = (r, name) => page.getByRole(r, { name, exact: true });
  const go = async (path) => {
    await page.goto(origin + path);
    await page.locator("main h1").first().waitFor();
  };
  await go("/app");
  await role("link", "Set up a mailbox").click();
  await role("heading", "Add domain").waitFor();
  await page.getByText("Import Cloudflare domains", { exact: true }).click();
  await role("button", "Copy command").waitFor();
  assert.ok(
    (await page.locator("main code").first().innerText()).includes(
      "pnpm domains:sync --apply --host 127.0.0.1",
    ),
  );
  await role("link", "Add a domain manually").click();
  assert.ok(
    await page
      .getByLabel("Domain name", { exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  console.log(
    "PASS installer · copyable installation-specific sync command and manual domain entry",
  );
  const boxes = [];
  for (const [domain, address, name] of [
    ["home.test", "orders@home.test", "Household orders"],
    ["studio.test", "support@studio.test", "Studio support"],
  ]) {
    const d = await json("/api/domains", { name: domain }),
      b = await json("/api/mailboxes", { name, address });
    boxes.push({ ...b, domain: d.id, address, name });
    await deliver(address, "Pickup reference");
  }
  const [, studio] = boxes;
  for (const who of ["editor", "reader"]) {
    await json("/api/users", { email: who + "@example.test" });
    await json("/api/mailboxes/" + studio.id + "/members", {
      email: who + "@example.test",
      role: who,
    });
  }
  const list = page.getByRole("list", { name: "Conversations" });
  const rows = list.getByRole("link", { name: /Pickup reference/ });
  const studioRow = rows.filter({ hasText: "Studio support" });
  await go("/inboxes");
  await studioRow.waitFor();
  const draftLink = role("navigation", "Folders").getByRole("link", {
    name: "Drafts",
    exact: true,
  });
  const initial = await draftLink.getAttribute("href");
  await studioRow.click();
  assert.equal(await draftLink.getAttribute("href"), initial);
  await go("/settings");
  await page.getByLabel("Find a setting").fill("dark mode");
  await role("link", "Color scheme").click();
  await page.getByLabel("Color scheme").waitFor();
  await page.waitForFunction(
    () => document.activeElement === document.querySelector("#color-scheme select"),
  );
  await go("/settings");
  await page.getByLabel("Find a setting").fill("out of office");
  await role("link", "Vacation reply").click();
  await page.getByLabel("Vacation message").waitFor();
  await go("/settings");
  await page.getByLabel("Find a setting").fill("contacts");
  await role("button", "Open composer").waitFor();
  await go("/settings/personal");
  await page.getByLabel("Reading layout").selectOption("compact");
  await go("/inboxes");
  await studioRow.waitFor();
  assert.equal(await rows.count(), 2);
  assert.ok(await studioRow.getByRole("img", { name: /1 attachment/ }).isVisible());
  assert.match(await studioRow.locator("time").innerText(), /\d{1,2}:\d{2}/);
  assert.ok((await studioRow.innerText()).includes("Studio support"));
  await page.getByLabel("Search mailbox").fill("has:attachment");
  await page.getByLabel("Search mailbox").press("Enter");
  await page.waitForURL("**/inboxes/search/**");
  await studioRow.click();
  await role("heading", "Pickup reference").waitFor();
  assert.match(await page.locator(".reader .back").getAttribute("href"), /^\/inboxes\/search\//);
  await page.goBack();
  await page.waitForURL(
    (url) => url.pathname.startsWith("/inboxes/search/") && !url.pathname.includes("/messages/"),
  );
  assert.ok(new URL(page.url()).pathname.startsWith("/inboxes/search/"));
  await go("/domains/" + studio.domain + "/inbox");
  await page.getByText("Filters", { exact: true }).click();
  await page.getByLabel("Has attachment").check();
  await role("button", "Apply filters").click();
  await page.waitForURL("**/inbox/search/**");
  await studioRow.waitFor();
  assert.equal(await rows.count(), 1);
  await go("/inboxes");
  await role("button", "Compose").click();
  let draft = role("dialog", "Compose");
  await draft.getByLabel("Subject", { exact: true }).fill("Business confirmation");
  await draft.getByLabel("Message", { exact: true }).fill("Tuesday works.");
  await draft.getByLabel("To", { exact: true }).fill("alex@vendor.test");
  await draft.getByLabel("To", { exact: true }).press("Enter");
  await draft.locator("input[type=file]").setInputFiles({
    name: "receipt.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Fictional receipt"),
  });
  await draft.getByText("receipt.txt", { exact: false }).first().waitFor();
  await draft.getByLabel("Sending mailbox").selectOption(studio.id);
  await page.waitForURL("**/mailboxes/" + studio.id + "/drafts/**");
  await draft.getByLabel("From address").waitFor();
  assert.equal(await draft.getByLabel("From address").inputValue(), studio.address);
  assert.equal(
    await draft.getByLabel("Subject", { exact: true }).inputValue(),
    "Business confirmation",
  );
  assert.equal(await draft.getByLabel("Message", { exact: true }).inputValue(), "Tuesday works.");
  await draft.getByText("receipt.txt", { exact: false }).first().waitFor();
  await draft.getByText("Send later", { exact: true }).click();
  await draft.getByRole("button", { name: /Tomorrow morning/ }).click();
  assert.match(await draft.getByLabel("Send at (local time)").inputValue(), /T09:00$/);
  await page.reload();
  await draft.getByRole("button", { name: "Send to capture" }).click();
  await draft.waitFor({ state: "hidden" });
  const prefix = "/mailboxes/" + studio.id;
  for (let i = 0; i < 60; i++) {
    if ((await json("/api" + prefix + "/messages?folder=sent")).messages.length) break;
    await sleep(500);
  }
  await go(prefix + "/sent");
  const sent = list.getByRole("link", { name: /Business confirmation/ });
  assert.match(await sent.innerText(), /To alex@vendor.test/);
  await sent.click();
  await role("heading", "Business confirmation").waitFor();
  await page.locator(".recipient-details summary").click();
  assert.match(await page.locator(".recipient-details").innerText(), /alex@vendor.test/);
  console.log(
    "PASS owner · stable folders, compact identities, scoped search, draft transfer with attachment and recipient-led Sent",
  );
  await go("/domains/" + studio.domain + "/setup");
  const progress = page.getByRole("region", { name: "Delivery setup progress" });
  await progress.waitFor();
  assert.match(await progress.innerText(), /Inbound mail\s+Received/);
  assert.match(await progress.innerText(), /Outbound mail\s+Captured locally/);
  await go(prefix + "/starred");
  await page.getByText(/No starred messages/).waitFor();
  await start("editor@example.test");
  await go(prefix + "/inbox");
  await list.getByRole("link", { name: /Pickup reference/ }).click();
  await role("heading", "Pickup reference").waitFor();
  await page.locator(".recipient-details summary").click();
  assert.match(await page.locator(".recipient-details").innerText(), /Cc\s+alex@vendor.test/);
  await role("button", "Reply all").click();
  await draft.getByLabel("From address").waitFor();
  assert.equal(await draft.getByLabel("From address").inputValue(), studio.address);
  assert.match(await draft.innerText(), /casey@vendor.test/);
  assert.match(await draft.innerText(), /alex@vendor.test/);
  await draft.getByRole("button", { name: "Discard draft" }).click();
  await draft.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".letter").scrollIntoViewIfNeeded();
  for (const label of ["Star", "Mark read", "Archive"]) {
    const bounds = await role("button", label).boundingBox();
    assert.ok(bounds.width >= 44 && bounds.height >= 44, label + " must be a 44px touch target");
  }
  await page.getByText("Snooze or follow up", { exact: true }).click();
  await page.getByRole("button", { name: /Tomorrow morning/ }).click();
  assert.match(await page.getByLabel("Reminder time").inputValue(), /T09:00$/);
  await page.setViewportSize({ width: 1280, height: 800 });
  await role("button", "Archive").click();
  await page.waitForURL("**/" + studio.id + "/inbox");
  await page.locator(".triage-notice button").click();
  await list.getByRole("link", { name: /Pickup reference/ }).waitFor();
  await go("/inboxes");
  await role("button", "Select messages").click();
  await role("button", "Select loaded messages").click();
  await role("button", "Move selected to Trash").click();
  await page.locator(".triage-notice button").click();
  await studioRow.waitFor();
  await go("/settings/personal");
  await page.getByLabel(/Mark read when opened/).check();
  await go(prefix + "/inbox");
  await list.getByRole("link", { name: /Pickup reference/ }).click();
  await role("button", "Mark unread").waitFor();
  await role("button", "Mark unread").click();
  await role("button", "Mark read").waitFor();
  console.log(
    "PASS editor · Reply all audience, archive recovery, scoped bulk trash and undo, optional shared read state",
  );
  await start("reader@example.test");
  await page.setViewportSize({ width: 390, height: 844 });
  await go(prefix + "/inbox");
  await list.getByRole("link", { name: /Pickup reference/ }).click();
  await role("heading", "Pickup reference").waitFor();
  await page.locator(".recipient-details summary").click();
  assert.match(await page.locator(".recipient-details").innerText(), /alex@vendor.test/);
  assert.equal(await role("button", "Reply").count(), 0);
  assert.equal((await json("/api/workspace")).mailboxes[0].unread, 1);
  const privateResult = await json("/api/inbox?q=has:attachment");
  assert.ok(privateResult.messages.every((m) => m.mailbox_id === studio.id));
  assert.equal(
    (
      await request("/api/inbox/triage", {
        ids: [privateResult.messages[0].id],
        field: "folder",
        value: "trash",
      })
    ).ok,
    false,
  );
  console.log(
    "PASS phone reader · accessible recipients, scoped search and preserved unread state",
  );
} finally {
  await browser?.close();
  await close();
}
