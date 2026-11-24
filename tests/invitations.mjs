import assert from "node:assert/strict";
export async function checkInvitations({ origin, start, page, json, request, box, sql }) {
  await start("owner@example.test");
  await page.goto(origin + "/settings/people");
  await page.getByText("People and invitations", { exact: true }).click();
  const email = "invited@fiction.test";
  await page.getByLabel("Person’s sign-in email").fill(email);
  await page.getByLabel("Share a mailbox", { exact: true }).selectOption(box);
  await page.getByLabel(/Send an invitation email from/).check();
  await page.getByRole("button", { name: "Save person and access" }).click();
  await page.getByText("Access saved. Invitation queued in Outbox.", { exact: true }).waitFor();
  const account = (await json("/api/users")).find((u) => JSON.parse(u.emails).includes(email));
  assert.equal(account.role, "member");
  const sent = await json("/api/users/invitations", { email, mailbox: box, send: true });
  assert.equal(sent.id, account.id);
  const invites = sql(
    "SELECT id,letter FROM outbox WHERE json_extract(letter,'$.to[0]')='invited@fiction.test'",
  );
  assert.equal(invites.length, 1);
  assert.ok(JSON.parse(invites[0].letter).body.includes(origin + "/mailboxes/" + box + "/inbox"));
  await page.getByLabel("Account for another sign-in address").selectOption(account.id);
  await page.getByLabel("Additional sign-in email").fill("alternate@fiction.test");
  await page.getByRole("button", { name: "Add sign-in address" }).click();
  await page.getByText("Sign-in address added.", { exact: true }).waitFor();
  await start("alternate@fiction.test");
  assert.equal((await json("/api/workspace")).mailboxes[0].id, box);
  assert.equal((await request("/api/users")).status, 403);
  await start("admin@example.test");
  const owner = sql("SELECT user_id FROM user_emails WHERE email='owner@example.test'")[0].user_id;
  assert.equal(
    (await request("/api/users/logins", { id: owner, email: "other@fiction.test" })).status,
    409,
  );
  console.log(
    "PASS · an administrator invites a reader, retries without a second email, grants an alternate login, and a delegated administrator cannot add a login to an owner",
  );
}
