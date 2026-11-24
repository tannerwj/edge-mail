import PostalMime from "postal-mime";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
export async function checkReplyThrough({ origin, sql, box, attempt }) {
  const [forward] = sql(
    "SELECT json_extract(letter,'$.replyAlias') alias FROM outbox WHERE id='" + attempt.id + "'",
  );
  assert.match(forward.alias, /^support\+emr-[a-f0-9]{32}@mail\.test$/);
  const copy = await fetch(origin + "/api/mailboxes/" + box + "/archive/" + attempt.id);
  assert.equal(copy.status, 200);
  const parsed = await PostalMime.parse(await copy.arrayBuffer());
  assert.equal(parsed.replyTo[0].address, forward.alias);
  async function send(from, header, auth, mark) {
    const raw = [
      "Authentication-Results: mx.cloudflare.net; dmarc=" + auth,
      "From: " + header,
      "To: " + forward.alias,
      "Cc: unrelated@fiction.test",
      "Reply-To: another@fiction.test",
      "Subject: Re: Queued notification",
      "Message-ID: <" + mark + "@reply.test>",
      "",
      "Fictional reply " + mark,
    ].join("\r\n");
    await fetch(
      origin + "/cdn-cgi/local/email?" + new URLSearchParams({ from, to: forward.alias }),
      { method: "POST", body: raw },
    );
  }
  const redeemed = () =>
    sql(
      "SELECT parent,letter,state FROM outbox WHERE json_extract(letter,'$.replyForward')='" +
        attempt.id +
        "'",
    );
  await send("wrong@fiction.test", "verified@example.test", "pass", "wrong-envelope");
  await send("verified@example.test", "wrong@fiction.test", "pass", "wrong-author");
  await send("verified@example.test", "verified@example.test", "fail", "bad-auth");
  await send(
    "verified@example.test",
    "verified@example.test, extra@fiction.test",
    "pass",
    "ambiguous",
  );
  await send("verified@example.test", "verified@example.test", "pass", "valid");
  for (let i = 0; i < 60 && !redeemed().length; i++) await sleep(100);
  const [item] = redeemed();
  assert.ok(item, "Expected one authorized reply");
  const letter = JSON.parse(item.letter);
  assert.deepEqual(letter.to, ["receipts@shop.test"]);
  assert.deepEqual(letter.cc, []);
  assert.deepEqual(letter.bcc, []);
  assert.equal(letter.body.trim(), "Fictional reply valid");
  assert.equal(item.parent, attempt.source_message);
  await send("verified@example.test", "verified@example.test", "pass", "replay");
  assert.equal(redeemed().length, 1);
  await fetch(origin + "/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*");
  for (let i = 0; i < 60 && redeemed()[0].state !== "sent"; i++) await sleep(100);
  assert.equal(redeemed()[0].state, "sent");
  console.log(
    "PASS · authenticated destination replies once through the mailbox, preserved original recipient and thread, diverted headers ignored",
  );
}
