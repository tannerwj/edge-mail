import assert from "node:assert/strict";
export async function checkComposeActions({ page, origin, box, json, request }) {
  await page.goto(origin + "/inboxes");
  await page.getByRole("list", { name: "Conversations" }).getByRole("link").first().click();
  await page.locator("article .body").waitFor();
  const conversation = page.url();
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compose" });
  await dialog.getByLabel("Subject", { exact: true }).waitFor();
  const draftUrl = page.url();
  const id = new URL(draftUrl).pathname.split("/").at(-1);
  const path = "/api/mailboxes/" + box + "/drafts/" + id;
  const to = dialog.getByLabel("To", { exact: true });
  await to.fill("wrong");
  await to.press("Enter");
  await dialog.getByText("Check the highlighted address.").waitFor();
  await dialog.getByRole("button", { name: "Options for wrong in To" }).click();
  await dialog.getByRole("button", { name: "Edit address" }).click();
  await to.fill("owner@example.test");
  await to.press("Enter");
  await to.fill("shortlist@example.test");
  await to.press("Enter");
  await dialog.getByRole("button", { name: "Options for shortlist@example.test in To" }).click();
  await dialog.getByRole("button", { name: "Move to Bcc" }).click();
  await dialog.getByRole("button", { name: "Options for shortlist@example.test in Bcc" }).waitFor();
  await to.fill("obsolete@example.test");
  await to.press("Enter");
  await dialog.getByRole("button", { name: "Remove obsolete@example.test from To" }).click();
  await dialog.getByLabel("Subject", { exact: true }).fill("Quarterly proof");
  await dialog.getByLabel("Message", { exact: true }).fill("The proof is attached.");
  await dialog.getByRole("button", { name: "Discard draft" }).click();
  await page.waitForURL(conversation);
  assert.equal((await request(path)).status, 404);
  await page.reload();
  await page.getByRole("button", { name: "Undo discard" }).click();
  await dialog.getByLabel("Subject", { exact: true }).waitFor();
  const saved = await json(path);
  assert.equal(saved.content.to, "owner@example.test");
  assert.equal(saved.content.bcc, "shortlist@example.test");
  assert.equal(saved.content.body, "The proof is attached.");
  assert.equal(
    (await request(path, { action: "discard", revision: saved.revision - 2 })).status,
    409,
  );
  await dialog.getByLabel("Message", { exact: true }).press("Control+Enter");
  await dialog.getByText("Did you mean to attach a file?").waitFor();
  assert.equal((await request("/api/mailboxes/" + box + "/outbox/" + id)).status, 404);
  await dialog.getByRole("button", { name: "Send anyway" }).click();
  await page.waitForURL(conversation);
  await page.getByRole("button", { name: "Undo send" }).click();
  await dialog.getByLabel("Message", { exact: true }).waitFor();
  assert.equal(
    await dialog.getByLabel("Message", { exact: true }).inputValue(),
    "The proof is attached.",
  );
  await dialog.getByRole("button", { name: "Close compose" }).click();
  console.log(
    "PASS · editable recipient chips, private move to Bcc, discard and restore, attachment reminder, keyboard send, in-place undo and preserved conversation",
  );
}
