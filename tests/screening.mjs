import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
export async function checkScreening({ page, origin, start, box, json, request, sql }) {
  await start("owner@example.test");
  const screen = "/api/mailboxes/" + box + "/screening";
  await page.goto(origin + "/settings/mail");
  await page.getByText("Sender screening", { exact: true }).click();
  await page.getByLabel("Review mailbox").selectOption(box);
  await page.getByLabel("Hold unknown senders for review").check();
  await page.getByRole("button", { name: "Save screening preferences" }).click();
  await page
    .locator("details")
    .filter({ has: page.getByText("Sender screening", { exact: true }) })
    .getByText("Saved.", { exact: true })
    .waitFor();
  const sender = "notice@review.test";
  const raw =
    "From: " +
    sender +
    "\r\nTo: support@mail.test\r\nSubject: Library return reminder\r\nMessage-ID: <book@review.test>\r\n\r\nYour book is due on Friday.";
  const send = () =>
    fetch(
      origin +
        "/cdn-cgi/local/email?" +
        new URLSearchParams({ from: sender, to: "support@mail.test" }),
      { method: "POST", body: raw },
    );
  assert.ok((await send()).ok);
  for (let i = 0; i < 60 && !(await json(screen)).pending.length; i++) await sleep(250);
  assert.ok((await json(screen)).pending.some((r) => r.sender === sender));
  const row = () =>
    sql(
      "SELECT m.id,m.folder,a.reason,a.held FROM messages m JOIN mail_assessment a ON m.id=a.message_id WHERE m.sender='notice@review.test'",
    )[0];
  assert.equal(row().folder, "spam");
  await page.reload();
  await page.getByText("Sender screening", { exact: true }).click();
  await page.getByLabel("Review mailbox").selectOption(box);
  await page.getByRole("button", { name: "Allow " + sender }).click();
  await page.getByText("No senders are waiting.").waitFor();
  assert.equal(row().folder, "inbox");
  assert.equal(row().held, 0);
  const feedback = screen + "/" + row().id;
  await json(feedback, { spam: true });
  await json(feedback, { spam: true });
  const counts = () => sql("SELECT spam,ham FROM spam_counts WHERE token=''")[0];
  assert.deepEqual(counts(), { spam: 1, ham: 0 });
  await json(feedback, { spam: false });
  assert.deepEqual(counts(), { spam: 0, ham: 1 });
  assert.equal(row().folder, "inbox");
  await json(screen, {
    action: "settings",
    screen_unknown: false,
    quarantine_auth: true,
    learn: false,
  });
  await start("reader@example.test");
  assert.equal((await request(feedback, { spam: true })).status, 404);
  assert.equal((await request(screen, { pattern: sender, disposition: "block" })).status, 403);
  console.log(
    "PASS · owner screens an unknown sender, releases held mail, corrects classifier feedback without double counting, and mailbox reader cannot train or change policy",
  );
}
