import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
export async function checkVacation({ origin, box, start, json, request, wrangler, state, sql }) {
  const rules = "/api/mailboxes/" + box + "/rules";
  const doc = {
    name: "Away from service desk",
    enabled: true,
    stop: false,
    order: 90,
    condition: { field: "subject", op: "equals", value: "Library desk question" },
    actions: [{ kind: "auto_reply", text: "I will return on Monday.", days: 7 }],
  };
  const save = { document: doc, scope: "mailbox", revision: 0 };
  await start("box-editor@example.test");
  assert.equal((await request(rules, save)).status, 403);
  await start("box-owner@example.test");
  const rule = await json(rules, save);
  const fixtures = [
    ["sunday", "person", "pass", ""],
    ["monday", "person", "pass", ""],
    ["list", "listreader", "pass", "List-Id: <library.example.test>"],
    ["auto", "robot", "pass", "Auto-Submitted: auto-generated"],
    ["fail", "unknown", "fail", ""],
  ];
  for (const [id, user, auth, extra] of fixtures) {
    const from = user + "@patron.test";
    const raw = [
      "Authentication-Results: mx.cloudflare.net; dmarc=" + auth,
      "From: " + from,
      "To: support@mail.test",
      "Reply-To: different@elsewhere.test",
      "Message-ID: <vacation-" + id + "@patron.test>",
      "Subject: Library desk question",
      ...(extra ? [extra] : []),
      "",
      "Is the desk open?",
    ].join("\r\n");
    assert.ok(
      (
        await fetch(
          origin + "/cdn-cgi/local/email?" + new URLSearchParams({ from, to: "support@mail.test" }),
          { method: "POST", body: raw },
        )
      ).ok,
    );
  }
  let count = 0;
  for (let i = 0; i < 30 && count !== fixtures.length; i++) {
    count = sql("SELECT count(*) n FROM messages WHERE wire_id LIKE '<vacation-%@patron.test>'")[0]
      .n;
    if (count !== fixtures.length) await sleep(150);
  }
  assert.equal(count, fixtures.length);
  const [r] = sql("SELECT r.id,o.letter FROM vacation_replies r JOIN outbox o ON o.id=r.id");
  assert.ok(r?.id);
  assert.equal(sql("SELECT count(*) n FROM vacation_replies")[0].n, 1);
  assert.deepEqual(JSON.parse(r.letter).to, ["person@patron.test"]);
  assert.ok((await fetch(origin + "/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*")).ok);
  assert.equal(sql("SELECT state FROM outbox WHERE id='" + r.id + "'")[0].state, "sent");
  const raw = wrangler([
    "r2",
    "object",
    "get",
    "edge-mail-receipts/sent/" + box + "/" + r.id + ".eml",
    "--local",
    "--persist-to",
    state,
    "--pipe",
  ]);
  assert.match(raw, /^Auto-Submitted: auto-replied\r?$/im);
  assert.match(raw, /^In-Reply-To: <vacation-(sunday|monday)@patron.test>\r?$/im);
  await json(rules + "/" + rule.id, { enabled: false, revision: 1 });
  console.log(
    "PASS · one vacation reply per sender, private reply template, envelope recipient, RFC 3834 header, list and automated mail skipped, editor denied",
  );
}
