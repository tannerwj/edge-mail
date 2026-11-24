import assert from "node:assert/strict";
import { ulid } from "ulid";

export async function checkOffboard({ page, origin, request, json, start, sql, box }) {
  const email = "departing@example.test";
  const endpoint = "/api/users/offboard";
  await start("owner@example.test");
  const user = await json("/api/users", { email });
  const own = await json("/api/mailboxes", { address: "departing@mail.test", name: "Personal" });
  const share = "/api/mailboxes/" + own.id + "/members";
  await json(share, { email, role: "owner" });
  await json(share, { email: "owner@example.test", role: "reader" });
  await json("/api/mailboxes/" + box + "/members", { email, role: "editor" });
  await start(email);
  assert.equal((await json("/api/workspace")).mailboxes.length, 2);
  assert.equal(
    (await request(endpoint, { email: "owner@example.test", dry_run: true })).status,
    403,
  );
  const drafts = "/api/mailboxes/" + box + "/drafts";
  const id = ulid();
  await json(drafts, { id });
  await json(drafts + "/" + id, {
    revision: 1,
    content: { to: "buyer@example.test", cc: "", bcc: "", subject: "Held order", body: "Test" },
  });
  await json("/api/mailboxes/" + box + "/outbox/" + id, {
    action: "send",
    revision: 2,
    scheduledFor: Date.now() + 3600000,
  });
  await start("admin@example.test");
  assert.equal(
    (await request(endpoint, { email: "owner@example.test", confirm: "owner@example.test" }))
      .status,
    403,
  );
  await start("owner@example.test");
  assert.equal((await request(endpoint, { email, confirm: "wrong@example.test" })).status, 400);
  await page.goto(origin + "/settings/people");
  await page.getByText("Disable user access", { exact: true }).click();
  await page.getByLabel("Account to disable").fill(email);
  await page.getByRole("button", { name: "Review access changes" }).click();
  await page.getByText(/ownership of 1 mailbox/).waitFor();
  await page.getByRole("button", { name: "Confirm disable access" }).click();
  await page.getByText(/Access disabled. Mailbox transfers: 1. Cancelled sends: 1/).waitFor();
  const again = await json(endpoint, { email, confirm: email });
  assert.equal(again.cancelled, 1);
  assert.equal(again.transferred, 1);
  assert.equal(
    sql("SELECT COUNT(*) n FROM offboard_receipts WHERE target='" + user.id + "'")[0].n,
    1,
  );
  assert.equal(sql("SELECT state FROM outbox WHERE id='" + id + "'")[0].state, "cancelled");
  assert.equal(
    sql(
      "SELECT e.email FROM mailbox_members m JOIN user_emails e ON e.user_id=m.user_id WHERE role='owner' AND m.mailbox_id='" +
        own.id +
        "'",
    )[0].email,
    "owner@example.test",
  );
  assert.equal((await request(share, { email, role: "reader" })).status, 404);
  await start(email);
  assert.equal((await request("/api/workspace")).status, 403);
  assert.equal((await request("/api/mailboxes/" + box + "/messages")).status, 403);
  console.log(
    "PASS · second person opens personal and shared mailboxes, offboarding transfers sole ownership, cancels queued mail, rejects sign-in and returns the original receipt on retry",
  );
}
