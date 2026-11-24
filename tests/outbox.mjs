import { checkComposeActions } from "./compose-actions.mjs";
import assert from "node:assert/strict";
import { ulid } from "ulid";
import { setTimeout as sleep } from "node:timers/promises";
export async function checkOutbox({ origin, page, json, request, box, start, sql }) {
  const base = "/api/mailboxes/" + box,
    drafts = base + "/drafts",
    out = base + "/outbox/";
  async function make(subject) {
    const id = ulid(),
      draft = await json(drafts, { id });
    await json(drafts + "/" + id, {
      revision: draft.revision,
      content: {
        to: "customer@outside.test",
        cc: "",
        bcc: "private@outside.test",
        subject,
        body: "Your order is confirmed.",
      },
    });
    return id;
  }
  await checkComposeActions({ page, origin, box, json, request });
  const id = await make("Order update");
  await page.goto(origin + "/mailboxes/" + box + "/drafts/" + id);
  await page.getByRole("button", { name: "Send to capture" }).click();
  await page.getByRole("button", { name: "Undo send" }).click();
  await page
    .getByRole("dialog", { name: "Compose" })
    .getByLabel("Subject", { exact: true })
    .waitFor();
  const restored = new URL(page.url()).pathname.split("/").at(-1);
  assert.notEqual(restored, id);
  assert.equal((await json(drafts + "/" + restored)).content.bcc, "private@outside.test");
  assert.equal((await json(out + id)).state, "cancelled");
  assert.equal((await json(out + id, { action: "undo" })).id, restored);
  await page.getByRole("button", { name: "Close compose" }).click();
  const scheduled = await make("Scheduled confirmation");
  assert.equal(
    (
      await request(out + scheduled, {
        action: "send",
        revision: 2,
        scheduledFor: Date.now() - 1000,
      })
    ).status,
    400,
  );
  await page.goto(origin + "/mailboxes/" + box + "/drafts/" + scheduled);
  await page.getByText("Send later", { exact: true }).click();
  const localTime = new Date().getFullYear() + 1 + "-01-15T14:00";
  await page.getByLabel("Send at (local time)").fill(localTime);
  await page.getByRole("button", { name: "Schedule send" }).click();
  await page.waitForURL("**/inbox");
  await page.reload();
  assert.equal(
    (await json(out + scheduled)).due_ms,
    await page.evaluate((s) => new Date(s).getTime(), localTime),
  );
  assert.equal((await json(out + scheduled)).state, "held");
  assert.equal((await json(out + scheduled)).attempts, 0);
  await page.getByRole("link", { name: "Scheduled", exact: true }).click();
  await page.getByRole("heading", { name: "Scheduled", exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancel scheduled send" }).click();
  await page
    .getByRole("dialog", { name: "Compose" })
    .getByLabel("Subject", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close compose" }).click();
  assert.equal((await json(out + scheduled)).state, "cancelled");
  const sent = await make("Confirming the order");
  const attachmentBytes = Buffer.from([0, 255, 1, 2, 3, 128, 10, 13]);
  await page.goto(origin + "/mailboxes/" + box + "/drafts/" + sent);
  await page.getByLabel("Add files").setInputFiles({
    name: "réceipt.bin",
    mimeType: "application/octet-stream",
    buffer: attachmentBytes,
  });
  await page.getByRole("button", { name: "Remove réceipt.bin" }).waitFor();
  await page.getByRole("button", { name: "Send to capture" }).waitFor();
  await page.waitForFunction(
    () => document.querySelector(".composer output")?.textContent === "Saved",
  );
  await page.reload();
  await page.getByRole("button", { name: "Remove réceipt.bin" }).waitFor();
  const source = await json(drafts + "/" + sent);
  const invalid = await make("Wrong draft attachment");
  await json(drafts + "/" + invalid, { revision: 2, content: source.content });
  assert.equal((await request(out + invalid, { revision: 3, action: "send" })).status, 409);
  const payload = { action: "send", revision: 2, undoSeconds: 5 };
  const later = { ...payload, revision: source.revision, scheduledFor: Date.now() + 9000 };
  const race = await Promise.all([json(out + sent, later), json(out + sent, later)]);
  assert.deepEqual(
    race.map((r) => r.id),
    [sent, sent],
  );
  assert.equal(race[0].due_ms, later.scheduledFor);
  for (let i = 0; i < 100 && (await json(out + sent)).state === "held"; i++) await sleep(200);
  for (let i = 0; i < 80 && (await json(out + sent)).state === "claimed"; i++) await sleep(200);
  const receipt = await json(out + sent);
  assert.equal(receipt.state, "sent", JSON.stringify(receipt));
  assert.equal(receipt.attempts, 1);
  assert.equal(receipt.provider_id, "capture-" + sent);
  assert.equal((await json(out + id)).state, "cancelled");
  assert.equal((await request(out + sent, { action: "cancel" })).status, 409);
  assert.deepEqual(
    (await json(base + "/messages?q=in:sent")).messages.map((m) => m.id),
    [sent],
  );
  const delivered = await json(base + "/messages/" + sent);
  assert.equal(delivered.body, "Your order is confirmed.");
  assert.equal(delivered.attachment_count, 1);
  const resources = base + "/attachments/" + sent;
  assert.equal((await json(resources)).files[0].name, "réceipt.bin");
  const file = await json(resources + "?part=0");
  assert.deepEqual(Buffer.from(await (await fetch(file.href)).arrayBuffer()), attachmentBytes);
  assert.ok(!JSON.stringify(delivered).includes("private@outside.test"));
  // Interrupt a second submission after its claim. An expired claim cannot submit again.
  const lost = await make("Interrupted");
  await json(out + lost, { ...payload, undoSeconds: 30, reopen: true });
  sql("UPDATE outbox SET state='claimed',claimed_ms=1,attempts=1 WHERE id='" + lost + "'");
  assert.equal((await request(out + lost, { action: "undo" })).status, 409);
  await fetch(origin + "/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*");
  assert.equal((await json(out + lost)).state, "uncertain");
  await start("reader@example.test");
  assert.equal((await request(out + sent)).status, 404);
  assert.equal((await request(out + sent, payload)).status, 403);
  await start("box-editor@example.test");
  sql(
    "UPDATE outbox SET provider='cloudflare',from_addr='support@mail.test',provider_id='<event-id@mail.test>' WHERE id='" +
      sent +
      "'",
  );
  // Supply the wire ID our live provider normally returns for the captured submission.
  sql("UPDATE messages SET wire_id='<event-id@mail.test>',synthetic=0 WHERE id='" + sent + "'");
  for (const [sender, joins] of [
    ["customer", true],
    ["private", false],
    ["stranger", false],
  ]) {
    const from = sender + "@outside.test";
    const subject = "Outbound reference test " + sender;
    const raw = [
      "From: " + from,
      "To: support@mail.test",
      "Subject: " + subject,
      "In-Reply-To: <event-id@mail.test>",
      "Message-ID: <sent-reply-" + sender + "@outside.test>",
      "",
      subject,
    ].join("\r\n");
    const response = await fetch(
      origin + "/cdn-cgi/local/email?" + new URLSearchParams({ from, to: "support@mail.test" }),
      { method: "POST", body: raw },
    );
    assert.ok(response.ok);
    let reply;
    for (let i = 0; i < 100 && !reply; i++) {
      reply = (
        await json(base + "/messages?q=" + encodeURIComponent('"' + subject + '"'))
      ).messages.at(0);
      if (!reply) await sleep(150);
    }
    assert.ok(reply);
    assert.equal(reply.thread_id, joins ? sent : reply.id);
  }
  await start("box-editor@example.test", true);
  const now = new Date().toISOString();
  async function event(kind, n, recipient = "customer@outside.test", sender = "support@mail.test") {
    await json("/test/delivery-event", {
      type: "cf.email.sending.message." + kind,
      source: { type: "email.sending", domain: "mail.test" },
      payload: { sender, recipient, eventId: "fixture-" + n, messageId: "event-id@mail.test" },
      metadata: { eventTimestamp: now },
    });
  }
  await event("delivered", 1);
  await event("delivered", 1);
  await event("deferred", 2);
  await event("bounced", 3, "private@outside.test");
  await event("complained", 4);
  await event("bounced", 5, "customer@outside.test", "other@mail.test");
  const detail = base + "/messages/" + sent;
  assert.deepEqual((await json(detail)).deliveryStatus, [
    { kind: "complained", recipients: 1 },
    { kind: "delivered", recipients: 1 },
  ]);
  await page.goto(origin + "/?" + new URLSearchParams({ box, message: sent }));
  await page.getByText("Delivered · 1 recipient").waitFor();
  await page.getByText("Complained · 1 recipient").waitFor();
  sql("UPDATE outbox SET provider='capture' WHERE id='" + sent + "'");
  await start("box-editor@example.test");
  console.log(
    "PASS · recipient delivery badges, duplicate and late events, complaints, foreign sender isolation and private Bcc",
  );
  console.log(
    "PASS · browser send and undo, concurrent submission, durable alarm, private Sent copy, lost acknowledgement and scope",
  );
}
