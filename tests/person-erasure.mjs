import assert from "node:assert/strict";
import { ulid } from "ulid";
export async function checkPersonErasure({ start, request, json, page, origin, box, sql }) {
  const email = "erase-person@example.test",
    path = "/api/users/erasure";
  await start("owner@example.test");
  const person = await json("/api/users", { email });
  const [domain] = sql("SELECT id FROM domains WHERE name='mail.test'");
  await json("/api/domains/" + domain.id + "/admins", { email });
  await json("/api/mailboxes/" + box + "/members", { email, role: "editor" });
  await start(email);
  const own = await json("/api/mailboxes", {
    address: "erase-person@mail.test",
    name: "Personal correspondence",
  });
  const draft = ulid();
  await json("/api/mailboxes/" + box + "/drafts", { id: draft });
  await json("/api/mailboxes/" + box + "/drafts/" + draft, {
    revision: 1,
    content: {
      to: "fictional@example.test",
      cc: "",
      bcc: "",
      subject: "Private draft",
      body: "Private text.",
    },
  });
  const raw =
    "From: fictional@example.test\r\nTo: erase-person@mail.test\r\nMessage-ID: <bluebird@fiction.test>\r\nSubject: Private bluebird\r\n\r\nPrivate content.";
  const delivery = await fetch(
    origin + "/cdn-cgi/local/email?from=fictional%40example.test&to=erase-person%40mail.test",
    { method: "POST", body: raw },
  );
  assert.ok(
    delivery.ok,
    "Fictional erasure receipt " + delivery.status + " " + (await delivery.text()),
  );
  await page.goto(origin + "/mailboxes/" + own.id + "/inbox");
  await page.getByRole("link", { name: /Private bluebird/ }).waitFor();
  assert.equal((await request(path, { action: "preview", target: person.id })).status, 403);
  await start("owner@example.test");
  const plan = await json(path, { action: "preview", target: person.id });
  assert.deepEqual(plan.boxes, [own.id]);
  assert.equal(plan.drafts, 1);
  assert.equal(
    (await request(path, { action: "erase", target: person.id, confirm: person.id, boxes: [box] }))
      .status,
    409,
  );
  await page.goto(origin + "/settings/people");
  await page.getByText("Erase a person’s data", { exact: true }).click();
  await page.getByLabel("Person to erase").selectOption(person.id);
  await page.getByRole("button", { name: "Review data erasure" }).click();
  await page.getByLabel("Type " + email + " to confirm").fill(email);
  await page.getByRole("button", { name: "Permanently erase this person" }).click();
  await page.getByText(new RegExp("Receipt " + person.id)).waitFor();
  for (let n = 0; n < 15; n++) {
    const receipt = await json(path, {
      action: "erase",
      target: person.id,
      confirm: person.id,
      boxes: plan.boxes,
    });
    if (receipt.finished) break;
  }
  const receipt = await json(path, { action: "receipt", target: person.id });
  assert.equal(receipt.finished, 1);
  assert.equal(receipt.pending_storage, 0);
  assert.equal(sql("SELECT id FROM mailboxes WHERE id='" + own.id + "'").length, 0);
  assert.equal(sql("SELECT id FROM drafts WHERE id='" + draft + "'").length, 0);
  assert.equal(sql("SELECT id FROM messages WHERE subject='Private bluebird'").length, 0);
  assert.ok(sql("SELECT id FROM messages WHERE mailbox_id='" + box + "' LIMIT 1").length);
  await start(email);
  assert.equal((await request("/api/workspace")).status, 403);
  console.log(
    "PASS · instance owner confirms person erasure, deletes the personal mailbox and private draft, retains another mailbox’s messages and verifies a durable completed receipt",
  );
}
