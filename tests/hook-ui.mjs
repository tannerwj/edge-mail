import assert from "node:assert/strict";
export async function checkHookForm({ page, start, origin, box }) {
  await start("owner@example.test");
  await page.goto(origin + "/settings/integrations");
  await page.getByText("Webhooks", { exact: true }).click();
  await page.getByLabel("Webhook mailbox").selectOption(box);
  await page.getByLabel("Receiver URL").fill("https://hooks.example.test/owner-events");
  await page.getByRole("button", { name: "Create webhook" }).click();
  const key = page.getByRole("textbox", { name: "Webhook signing key" });
  await key.waitFor();
  assert.equal((await key.inputValue()).length, 43);
  await page.getByRole("button", { name: "Hide key" }).click();
  assert.equal(await key.count(), 0);
  await page.getByRole("button", { name: "Disable webhook" }).click();
  await page.getByText("Webhook disabled.", { exact: true }).waitFor();
  console.log(
    "PASS · a mailbox owner issues a webhook signing key once, hides it and disables the destination in Settings",
  );
}
