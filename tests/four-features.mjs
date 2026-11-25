import { strict as assert } from "node:assert";
import { ulid } from "ulid";

async function swipe(page, row, left) {
  await row.scrollIntoViewIfNeeded();
  const rect = await row.boundingBox(),
    y = Math.round(rect.y + rect.height / 2);
  const x = Math.round(rect.x + rect.width * (left ? 0.76 : 0.24)),
    end = x + (left ? -110 : 110);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (const step of [0.33, 0.66, 1])
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: Math.round(x + (end - x) * step), y }],
      });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}
export async function fourFeatures({ page, go, role, boxes, json, request, start, deliver }) {
  const [, studio] = boxes,
    prefix = "/mailboxes/" + studio.id,
    api = "/api" + prefix;
  await start("owner@example.test");
  await page.setViewportSize({ width: 1280, height: 800 });

  for (const box of boxes) {
    const path = "/api/mailboxes/" + box.id,
      create = (subject) =>
        json(path + "/drafts", {
          id: ulid(),
          content: {
            subject,
            to: "alex@vendor.test",
            cc: "",
            bcc: "",
            body: "Fictional pickup note",
          },
        });
    await create("Private note " + box.name);
    const scheduled = await create("Later " + box.name);
    await json(path + "/outbox/" + scheduled.id, {
      action: "send",
      revision: scheduled.revision,
      scheduledFor: Date.now() + 86400000,
      reopen: true,
    });
  }
  await go("/inboxes");
  await role("link", "All drafts").click();
  for (const box of boxes)
    await page
      .locator(".queue-row")
      .filter({ hasText: "Private note " + box.name })
      .waitFor();
  await page.locator(".queue-row").filter({ hasText: "Private note Studio support" }).click();
  const dialog = role("dialog", "Compose");
  assert.equal(await dialog.getByLabel("From address").inputValue(), studio.address);
  await dialog.getByRole("button", { name: "Discard draft" }).click();
  await page.waitForURL("**/inboxes/drafts");
  await role("link", "All scheduled").click();
  await page.locator(".queue-row").filter({ hasText: "Later Household orders" }).waitFor();
  await page
    .locator(".queue-row")
    .filter({ hasText: "Later Studio support" })
    .getByRole("button", { name: "Cancel scheduled send" })
    .click();
  assert.equal(await dialog.getByLabel("From address").inputValue(), studio.address);
  await dialog.getByRole("button", { name: "Discard draft" }).click();
  await role("link", "All sent").click();
  const sent = page
    .getByRole("list", { name: "Conversations" })
    .getByRole("link", { name: /Business confirmation/ });
  assert.match(await sent.innerText(), /Studio support/);
  assert.match(await sent.innerText(), /alex@vendor.test/);
  await sent.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".reader .back").click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForURL("**/inboxes/sent");
  const rootId = "<" + ulid() + "@vendor.test>";
  await deliver(studio.address, "Packing checklist", {
    wire: rootId,
    body: "First checklist body.",
  });
  await deliver(studio.address, "Re: Packing checklist", {
    reply: rootId,
    body: "Revised checklist body.",
  });
  const list = page.getByRole("list", { name: "Conversations" });
  const threadRow = list.getByRole("link", { name: /Packing checklist/i });
  await go(prefix + "/inbox");
  await threadRow.first().click();
  await page.getByText("Conversation · 2 messages").click();
  await role("button", "Expand Packing checklist").click();
  await page.getByText("First checklist body.", { exact: true }).waitFor();
  const readerUrl = page.url();
  await role("button", "Collapse Packing checklist").click();
  assert.equal(page.url(), readerUrl);
  const latest = (await json(api + "/messages?group=thread")).messages.find((m) =>
    m.subject.includes("Packing checklist"),
  );
  const claimPath = api + "/claims/" + latest.thread_id;
  await role("button", "Claim conversation").click();
  await role("button", "Release claim").waitFor();
  await start("editor@example.test");
  await go(prefix + "/inbox");
  await threadRow.getByTitle("Claimed by owner@example.test").waitFor();
  assert.match(await threadRow.innerText(), /owner@example.test/);
  await threadRow.click();
  assert.equal(await role("button", "Release claim").count(), 0);
  assert.equal((await request(claimPath, { action: "claim" })).status, 409);
  assert.equal((await request(claimPath, { action: "release" })).status, 409);
  assert.equal((await json("/api/inboxes/drafts")).items.length, 0);
  assert.equal((await json("/api/inboxes/scheduled")).items.length, 0);
  await start("owner@example.test");
  await go(readerUrl.replace(new URL(readerUrl).origin, ""));
  await role("button", "Release claim").click();
  await role("button", "Claim conversation").waitFor();
  await start("editor@example.test");
  await go(prefix + "/inbox");
  await threadRow.click();
  await role("button", "Claim conversation").click();
  await role("button", "Release claim").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await go("/settings/personal");
  await page.getByLabel(/Swipe inbox rows on this device/).check();
  await go(prefix + "/inbox");
  await swipe(page, threadRow, false);
  await page.locator(".triage-notice").filter({ hasText: "Conversation archived" }).waitFor();
  await threadRow.waitFor({ state: "hidden" });
  await role("button", "Undo").click();
  await threadRow.waitFor();
  await swipe(page, threadRow, true);
  await page
    .locator(".triage-notice")
    .getByText(/Snoozed until/)
    .waitFor();
  await go(prefix + "/snoozed");
  await threadRow.waitFor();
  await json(api + "/reminders", { action: "thread_snooze", ids: [latest.thread_id], at: null });
  await go(prefix + "/inbox");
  await threadRow.waitFor();
  const actions = threadRow.locator("..").getByRole("button", { name: "Conversation actions" });
  await actions.click();
  await role("button", "Snooze until tomorrow at 9 AM").click();
  await page.locator(".triage-notice").getByRole("button", { name: "Undo" }).click();
  await threadRow.waitFor();
  await json(api + "/messages/" + latest.thread_id, { field: "is_read", value: false });
  await json(api + "/messages/" + latest.id, { field: "is_read", value: true });
  await start("reader@example.test");
  await go(prefix + "/inbox");
  await threadRow.waitFor();
  assert.equal(await role("button", "Conversation actions").count(), 0);
  await swipe(page, threadRow, false);
  await threadRow.click();
  await role("heading", "Re: Packing checklist").waitFor();
  assert.equal(await role("button", "Claim conversation").count(), 0);
  assert.equal((await request(claimPath, { action: "release" })).status, 403);
  await page.getByText("Conversation · 2 messages").click();
  await role("button", "Expand Packing checklist").click();
  await page.getByText("First checklist body.", { exact: true }).waitFor();
  assert.equal((await json(api + "/messages/" + latest.thread_id)).is_read, 0);
  await role("link", "Jump to latest unread").click();
  await role("heading", "Packing checklist").waitFor();
  assert.equal((await json(api + "/messages/" + latest.thread_id)).is_read, 0);
  console.log(
    "PASS owner · combined drafts, schedules, cancel to original mailbox, recipient-led Sent, inline history and claim handoff",
  );
  console.log(
    "PASS editor and phone reader · claim conflict, private work isolation, swipe archive and snooze with Undo, visible action and protected read-only history",
  );
}
