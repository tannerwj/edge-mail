import assert from "node:assert/strict";
export async function checkIdentity({ page, start, origin, json, request, box, sql }) {
  await start("owner@example.test");
  assert.ok(
    (await json("/api/mailboxes/" + box + "/identities")).some(
      (v) => v.from === "orders@mail.test",
    ),
  );
  await page.goto(origin + "/settings/mail");
  await page.getByText("Sending identities and signatures", { exact: true }).click();
  await page.getByLabel("Sending mailbox").selectOption(box);
  await page.getByLabel("Sending identity", { exact: true }).selectOption("orders@mail.test");
  await page.getByLabel("Signature", { exact: true }).fill("Orders desk");
  await page.getByRole("button", { name: "Save signature" }).click();
  await page.getByText("Signature saved.").waitFor();
  await page.goto(origin + "/mailboxes/" + box + "/inbox");
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByLabel("From address").selectOption("orders@mail.test");
  await page.getByText("Orders desk", { exact: true }).waitFor();
  await page.getByLabel("To", { exact: true }).fill("member@example.test");
  await page.getByLabel("Subject", { exact: true }).fill("Pickup counter");
  await page.getByLabel("Message", { exact: true }).fill("Parcel is ready.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Send to capture", exact: true }).click();
  const [sent] = sql(
    "SELECT id,from_addr,reply_addr,json_extract(letter,'$.body') body FROM outbox WHERE json_extract(letter,'$.subject')='Pickup counter'",
  );
  assert.equal(sent.from_addr, "orders@mail.test");
  assert.equal(sent.reply_addr, "support@mail.test");
  assert.equal(sent.body, "Parcel is ready.\n\n-- \nOrders desk");
  await json("/api/mailboxes/" + box + "/outbox/" + sent.id, { action: "cancel" });
  await start("reader@example.test");
  assert.equal(
    (
      await request("/api/mailboxes/" + box + "/signatures", {
        from: "orders@mail.test",
        signature: "change",
      })
    ).status,
    403,
  );
  await start("owner@example.test");
  console.log(
    "PASS · mailbox owner sets an alias signature, composes from that identity, inspects the actual queued envelope and reader cannot change sender settings",
  );
}
