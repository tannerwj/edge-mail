import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
export async function checkConversations({ origin, list, json, page, box, root }) {
  const send = async (id, from, subject, headers = []) => {
    const body = [
      "From: " + from,
      "To: support@mail.test",
      "Subject: " + subject,
      "Message-ID: <" + id + "@conversation.test>",
      ...headers,
      "",
      "Fixture " + id,
    ].join("\r\n");
    const res = await fetch(
      origin + "/cdn-cgi/local/email?" + new URLSearchParams({ from, to: "support@mail.test" }),
      { method: "POST", body },
    );
    assert.ok(res.ok);
    for (let i = 0; i < 100; i++) {
      const rows = (await json(list + "?q=" + encodeURIComponent('"Fixture ' + id + '"'))).messages;
      if (rows.length) return rows[0].id;
      await sleep(150);
    }
    throw Error("Conversation ingest timed out");
  };
  const reply = await send("reply", "customer@outside.test", "Changed subject", [
    "In-Reply-To: <fixture@outside.test>",
  ]);
  const original = await json(list + "/" + root);
  assert.deepEqual(new Set(original.conversation.map((row) => row.id)), new Set([root, reply]));
  const fake = await send("other", "new@outside.test", "Delivery question", [
    "References: <fixture@outside.test>",
  ]);
  const auto = await send("robot", "customer@outside.test", "Re: Delivery question", [
    "Auto-Submitted: auto-generated",
  ]);
  for (const isolated of [fake, auto])
    assert.deepEqual(
      (await json(list + "/" + isolated)).conversation.map((r) => r.id),
      [isolated],
    );
  const followup = await send("followup", "customer@outside.test", "RE: Delivery question");
  const group = (await json(list + "?group=thread")).messages.find((m) => m.thread_id === root);
  assert.equal(group.message_count, 3);
  await json(list + "/" + followup, { field: "folder", value: "archive" });
  const visible = (await json(list + "?group=thread")).messages.find((m) => m.thread_id === root);
  assert.equal(visible.message_count, 2);
  await page.goto(origin + "/?" + new URLSearchParams({ box, message: root }));
  await page.getByText("Conversation · 3 messages").click();
  await page
    .locator(".conversation")
    .getByRole("link", { name: /Changed subject/ })
    .click();
  await page.getByRole("heading", { name: "Changed subject", exact: true }).waitFor();
  console.log(
    "PASS · same-participant references, bounded subject fallback, automated and unfamiliar senders stay separate, folder summaries and conversation navigation",
  );
}
