import { checkReplyThrough } from "./reply-through.mjs";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

export async function checkForward({ page, start, origin, box, json, request, sql }) {
  const base = "/api/mailboxes/" + box,
    destinations = base + "/destinations",
    rules = base + "/rules",
    address = "verified@example.test";
  await start("box-owner@example.test");
  await page.goto(origin + "/settings/mail");
  await page.getByText("Mail rules", { exact: true }).click();
  await page.getByLabel("Rules for mailbox").selectOption(box);
  await page.getByText("Forwarding destinations", { exact: true }).click();
  await page.getByLabel("Forwarding email").fill(address);
  await page.getByRole("button", { name: "Add destination" }).click();
  await page.getByText(/Pending verification/).waitFor();
  assert.equal((await request(destinations, { address: "support+test@mail.test" })).status, 409);
  const [dest] = await json(destinations);
  const doc = {
    name: "Forward receipts",
    order: 200,
    stop: false,
    enabled: true,
    condition: { field: "from", op: "equals", value: "receipts@shop.test" },
    actions: [
      { kind: "label", value: "Forwarded" },
      { kind: "forward", mode: "relay", destination: dest.id },
    ],
  };
  const save = { document: doc, revision: 0, scope: "mailbox" };
  assert.equal((await request(rules, save)).status, 409);
  // Seed the provider's positive verification at the network boundary.
  sql("UPDATE egress_destinations SET verified_at=CURRENT_TIMESTAMP WHERE id='" + dest.id + "'");
  const rule = await json(rules, save),
    selected = rules + "/" + rule.id;
  await start("box-editor@example.test");
  assert.equal((await request(destinations)).status, 403);
  assert.equal((await request(selected, { revision: 1, enabled: false })).status, 403);
  await start("box-owner@example.test", true);
  const relay = (id, extra) => json("/test/relay", { id, box, ...extra });
  assert.deepEqual((await relay("<capture@shop.test>", { capture: true })).calls, []);
  assert.equal(
    sql("SELECT state FROM forward_attempts WHERE source='<capture@shop.test>'")[0].state,
    "captured",
  );
  const success = await relay("<relay@shop.test>");
  assert.equal(success.calls[0]?.recipient, address);
  assert.ok(success.calls[0].marker);
  assert.deepEqual((await relay("<relay@shop.test>")).calls, []);
  assert.deepEqual((await relay("<loop@shop.test>", { loop: true })).calls, []);
  assert.equal((await relay("<lost@shop.test>", { fail: true })).calls.length, 1);
  assert.deepEqual((await relay("<lost@shop.test>")).calls, []);
  assert.equal(
    sql("SELECT state FROM forward_attempts WHERE source='<lost@shop.test>'")[0].state,
    "uncertain",
  );
  const document = {
    ...doc,
    condition: { field: "subject", op: "equals", value: "Queued notification" },
    actions: [{ kind: "forward", mode: "resend", destination: dest.id, reply_through: true }],
  };
  await json(selected, { revision: 1, document });
  await start("box-owner@example.test");
  const raw = [
    "Authentication-Results: mx.cloudflare.net; dmarc=pass",
    "From: receipts@shop.test",
    "To: support@mail.test",
    "Message-ID: <resend-proof@shop.test>",
    "Subject: Queued notification",
    "",
    "Order from the test shop.",
  ].join("\r\n");
  const deliver = () =>
    fetch(origin + "/cdn-cgi/local/email?from=receipts%40shop.test&to=support%40mail.test", {
      method: "POST",
      body: raw,
    });
  assert.ok((await deliver()).ok);
  let attempt;
  for (let i = 0; i < 25 && !attempt; i++) {
    attempt = sql("SELECT * FROM forward_attempts WHERE source='<resend-proof@shop.test>'")[0];
    if (!attempt) await sleep(200);
  }
  assert.ok(attempt, "Queued resend attempt persisted");
  await fetch(origin + "/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*");
  let sent;
  for (let i = 0; i < 30 && !sent; i++) {
    sent = (await json(base + "/messages?q=" + encodeURIComponent("in:sent subject:Queued")))
      .messages[0];
    if (!sent) await sleep(200);
  }
  assert.equal(sent?.attachment_count, 1, "Original MIME is attached to the captured resend");
  assert.equal(
    sql("SELECT state FROM forward_attempts WHERE id='" + attempt.id + "'")[0].state,
    "submitted",
  );
  const link = await json(base + "/attachments/" + sent.id + "?part=0");
  assert.equal(await (await fetch(link.href)).text(), raw);
  await checkReplyThrough({ origin, sql, box, attempt });
  await json(destinations, { action: "disable", id: dest.id });
  assert.equal((await request(selected, { revision: 2, restore: 1 })).status, 409);
  console.log(
    "PASS · mailbox owner verifies a destination, relay deduplicates aliases and blocks loops, lost acknowledgements stay uncertain, queued resend retains the original MIME and respects revocation",
  );
}
