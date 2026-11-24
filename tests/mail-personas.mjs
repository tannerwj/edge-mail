import assert from "node:assert/strict";

async function openMailboxSetup(page, form) {
  await page.getByRole("link", { name: "Set up a mailbox" }).click();
  await page.getByRole("heading", { name: form, exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/settings/mailboxes");
}

export async function recoverEmptySearch(page, box) {
  await page.getByLabel("Search mailbox").fill("nomatchingpersonafixture");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("No messages match this search.", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Clear search" }).click();
  await page.getByRole("heading", { name: "Inbox", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/mailboxes/" + box + "/inbox");
  assert.equal(await page.getByLabel("Search mailbox").inputValue(), "");
}

export async function addFirstDomain(page) {
  await openMailboxSetup(page, "Add domain");
  const domainForm = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Add domain", exact: true }) });
  await domainForm.getByLabel("Domain name").fill("MAIL.test");
  const createdDomain = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/domains" && r.request().method() === "POST",
  );
  await domainForm.getByRole("button", { name: "Add domain" }).click();
  const result = await createdDomain;
  assert.ok(result.ok());
  const { id: domain } = await result.json();
  await domainForm.getByText("Saved", { exact: true }).waitFor();
  return domain;
}

export async function checkSharedReader(page, origin, box, privateBox) {
  await page.goto(origin + "/mailboxes/" + privateBox + "/inbox");
  await page.getByRole("heading", { name: "Mailbox unavailable" }).waitFor();
  await page.getByRole("link", { name: "Back to all inboxes" }).click();
  await page.getByRole("link", { name: /Delivery question/ }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/inboxes");
  await page.goto(origin + "/mailboxes/" + box + "/inbox");
  await page
    .locator(".list header")
    .getByText(/Read-only mailbox/)
    .waitFor();
  await page.getByRole("link", { name: /Delivery question/ }).click();
  await page.getByText("Please confirm the delivery window.", { exact: true }).last().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("heading", { name: "Delivery question" }).waitFor();
  await page.locator(".reading-toolbar").getByText("Read-only mailbox").waitFor();
  assert.equal(await page.getByRole("button", { name: "Reply", exact: true }).count(), 0);
  await page.locator(".reading-toolbar").getByRole("link", { name: "Inbox", exact: true }).click();
  await recoverEmptySearch(page, box);
  await page.getByRole("link", { name: /Delivery question/ }).waitFor();
  await page.setViewportSize({ width: 1280, height: 800 });
}

export async function addManagedMailbox(page, origin) {
  await page.goto(origin + "/app");
  await openMailboxSetup(page, "Add mailbox");
  const mailboxForm = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Add mailbox", exact: true }) });
  await mailboxForm.getByLabel("Display name").fill("Returns");
  await mailboxForm.getByLabel("Mailbox address").fill("returns@mail.test");
  await mailboxForm.getByRole("button", { name: "Add mailbox" }).click();
  await mailboxForm.getByText("Saved", { exact: true }).waitFor();
}
