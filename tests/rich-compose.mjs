import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import PostalMime from "postal-mime";
export async function checkRichCompose({ page, box, origin, json, start, sql }) {
  await start("owner@example.test");
  await page.goto(origin + "/mailboxes/" + box + "/inbox");
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByLabel("To", { exact: true }).fill("fictional@example.test");
  await page.getByLabel("Subject", { exact: true }).fill("Collection diagram");
  await page.getByLabel("Formatted message").check();
  const editor = page.getByRole("textbox", { name: "Message", exact: true });
  await editor.fill("Please collect today");
  await editor.press("End");
  for (let n = 0; n < 5; n++) await editor.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await editor.locator("strong", { hasText: "today" }).waitFor();
  await editor.press("End");
  await editor.press(".");
  await editor.press("Enter");
  await page.keyboard.insertText("Thank you.");

  assert.equal(await editor.textContent(), "Please collect **today**.\nThank you.");
  await page.getByText("Preview formatting", { exact: true }).click();
  await page.locator(".formatted-preview strong", { hasText: "today" }).waitFor();
  const png = await readFile("public/install/icon-192.png");
  const files = await page.evaluateHandle((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "collection.png", { type: "image/png" }));
    return transfer;
  }, Array.from(png));
  await editor.dispatchEvent("drop", { dataTransfer: files });
  await page.getByRole("button", { name: "Remove collection.png" }).click();
  await editor.evaluate((node, clipboardData) => {
    node.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
    );
  }, files);
  assert.ok(await page.getByLabel("Embed collection.png in the message").isChecked());
  await files.dispose();
  await page.getByLabel("Embed collection.png in the message").check();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const originalSize = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 680 });
  await page.getByText("Send later", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compose" });
  assert.ok(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    "The schedule controls must fit inside the composer on a small phone",
  );
  await page.getByLabel("Undo window").selectOption("5");
  await page.getByText("Send later", { exact: true }).click();
  await page.setViewportSize(originalSize);
  await editor.press("Control+Enter");
  await page.waitForURL("**/inbox");
  await page.getByRole("button", { name: "Undo send" }).click();
  await dialog.getByRole("button", { name: "Remove collection.png" }).waitFor();
  assert.equal(await editor.textContent(), "Please collect **today**.\nThank you.");
  await editor.press("Control+Enter");
  await page.waitForURL("**/inbox");
  const [item] = sql(
    "SELECT id FROM outbox WHERE json_extract(letter,'$.subject')='Collection diagram' AND state!='cancelled'",
  );
  assert.ok(item?.id);
  const path = "/api/mailboxes/" + box + "/outbox/" + item.id;
  for (let i = 0; i < 60 && (await json(path)).state === "held"; i++)
    await new Promise((r) => setTimeout(r, 250));
  assert.equal((await json(path)).state, "sent");
  const raw = await fetch(origin + "/api/mailboxes/" + box + "/archive/" + item.id);
  assert.equal(raw.status, 200);
  const parsed = await PostalMime.parse(await raw.arrayBuffer());
  assert.equal(parsed.text.trim(), "Please collect today.\nThank you.");
  assert.ok(parsed.html.includes("<strong>today</strong>"));
  const [file] = parsed.attachments;
  assert.equal(file.disposition, "inline");
  assert.equal(file.mimeType, "image/png");
  assert.ok(parsed.html.includes("cid:" + file.contentId.slice(1, -1)));
  assert.deepEqual(Buffer.from(file.content), png);
  console.log(
    "PASS · formatted composer, plain alternative, matching inline Content-ID and identical PNG bytes in captured Sent MIME",
  );
}
