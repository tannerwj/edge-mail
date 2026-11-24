import assert from "node:assert/strict";
export async function checkLibrary({ start, page, origin, box, json, request }) {
  await start("box-editor@example.test");
  const path = "/api/mailboxes/" + box;
  await page.goto(origin + "/mailboxes/" + box + "/drafts");
  await page
    .getByRole("heading", { name: "Drafts", exact: true })
    .waitFor()
    .catch(async (error) => {
      throw new Error(
        "Draft listing showed: " +
          (await page.locator("h1, [role=alert], [role=status]").allTextContents()).join(" | "),
        { cause: error },
      );
    });
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  const body = "Pickup is ready.\n\nBring the confirmation number.";
  await page.getByLabel("Subject", { exact: true }).fill("Pickup notice");
  await page.getByLabel("Message", { exact: true }).fill(body);
  await page.getByText("Templates and contacts", { exact: true }).click();
  await page.getByLabel("Name this draft as a template").fill("Pickup");
  await page.getByRole("button", { name: "Save template" }).click();
  await page
    .getByLabel("Saved template")
    .getByRole("option", { name: "Pickup", exact: true })
    .waitFor({ state: "attached" });
  await page.getByLabel("Contact name", { exact: true }).fill("Order desk");
  await page.getByLabel("Contact email", { exact: true }).fill("orders@fiction.test");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.getByRole("button", { name: "Remove contact orders@fiction.test" }).waitFor();
  await page.getByLabel("To", { exact: true }).fill("orders");
  assert.ok(
    (await json(path + "/contacts?q=order")).contacts.some(
      (r) => r.address === "orders@fiction.test",
    ),
  );
  await page.getByLabel("Message", { exact: true }).fill("");
  await page.getByLabel("Saved template").selectOption({ label: "Pickup" });
  await page.getByRole("button", { name: "Use template in draft" }).click();
  assert.equal(await page.getByLabel("Message", { exact: true }).inputValue(), body);
  await page.getByText("Saved", { exact: true }).last().waitFor();
  await start("box-owner@example.test");
  const shared = await json(path + "/library");
  assert.equal(
    shared.templates.some((t) => t.name === "Pickup"),
    false,
  );
  assert.ok(shared.contacts.some((c) => c.address === "orders@fiction.test"));
  await start("reader@example.test");
  assert.equal(
    (await request(path + "/library", { action: "contact_remove", address: "orders@fiction.test" }))
      .status,
    403,
  );
  console.log(
    "PASS · editor saves a multiline template, reuses it in a draft and shares a contact with the mailbox while keeping the template private",
  );
}
