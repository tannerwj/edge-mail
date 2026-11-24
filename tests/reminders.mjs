import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
export async function checkReminders({ origin, page, start, box, root, json, request, sql }) {
  const base = "/api/mailboxes/" + box,
    list = (folder) => json(base + "/messages?group=thread&folder=" + folder);
  const visible = async (folder) => (await list(folder)).messages.some((m) => m.thread_id === root);
  await start("box-editor@example.test");
  await page.goto(origin + "/mailboxes/" + box + "/inbox/messages/" + root);
  await page.getByText("Message tools & details", { exact: true }).click();
  await page.getByText("Conversation reminders", { exact: true }).click();
  await page
    .getByLabel("Reminder time")
    .fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16));
  await page.getByRole("button", { name: "Save reminder" }).click();
  await page.getByRole("button", { name: "End snooze" }).waitFor();
  assert.equal(await visible("inbox"), false);
  assert.equal(await visible("snoozed"), true);
  const change = (action, fields) => json(base + "/reminders", { action, ids: [root], ...fields });
  await start("reader@example.test");
  assert.ok((await json(base + "/messages/" + root)).thread.snoozed_until > Date.now());
  assert.equal(
    (await request(base + "/reminders", { action: "thread_snooze", ids: [root], at: null })).status,
    403,
  );
  await start("box-editor@example.test");
  sql("UPDATE thread_state SET snoozed_until=1 WHERE thread_id='" + root + "'");
  assert.equal(await visible("inbox"), true);
  await change("thread_follow_up", { at: Date.now() + 3600000, if_no_reply: true });
  await change("thread_mute", { muted: true });
  const raw = [
    "From: customer@outside.test",
    "To: support@mail.test",
    "Subject: Delivery timing update",
    "Message-ID: <reminder-reply@outside.test>",
    "In-Reply-To: <fixture@outside.test>",
    "",
    "Confirming the delivery window.",
  ].join("\r\n");
  assert.ok(
    (
      await fetch(
        origin + "/cdn-cgi/local/email?from=customer%40outside.test&to=support%40mail.test",
        { method: "POST", body: raw },
      )
    ).ok,
  );
  for (let i = 0; i < 100 && (await visible("follow-ups")); i++) await sleep(100);
  assert.equal(await visible("follow-ups"), false);
  const row = (await json(base + "/messages?q=subject%3A%22Delivery%20timing%20update%22"))
    .messages[0];
  assert.equal(row.folder, "archive");
  await change("thread_mute", { muted: false });
  await change("thread_follow_up", { at: Date.now() + 3600000, if_no_reply: false });
  sql("UPDATE thread_state SET follow_up_at=1 WHERE thread_id='" + root + "'");
  await start("owner@example.test", true);
  assert.ok((await fetch(origin + "/test/wake")).ok);
  assert.equal(
    sql("SELECT follow_ready FROM thread_state WHERE thread_id='" + root + "'")[0].follow_ready,
    1,
  );
  await start("owner@example.test");
  await change("thread_follow_up", { at: null });
  console.log(
    "PASS · shared snooze hides the conversation until its deadline, readers can inspect it, a reply cancels the conditional nudge and mute files that reply in Archive",
  );
}
