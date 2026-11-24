import assert from "node:assert/strict";

export async function checkComposeWindow(page, origin, box) {
  const original = page.viewportSize();
  const dialog = page.getByRole("dialog", { name: "Compose" });
  const subject = "Proofing notes for Friday";
  try {
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto(origin + "/mailboxes/" + box + "/inbox");
    await page.getByRole("button", { name: "Compose", exact: true }).click();
    await dialog.getByLabel("Subject", { exact: true }).fill(subject);
    await dialog.getByText("Saved", { exact: true }).waitFor();
    await page.reload();
    await dialog.getByLabel("Subject", { exact: true }).waitFor();
    assert.equal(await dialog.getAttribute("data-mode"), "pinned");
    assert.equal(await dialog.getByLabel("Subject", { exact: true }).inputValue(), subject);
    const initial = await dialog.boundingBox();
    assert.equal(Math.round(initial.y + initial.height), 850);
    assert.equal(Math.round(initial.x + initial.width), 1264);
    await dialog.getByRole("button", { name: "Unpin compose" }).click();
    const handle = dialog.locator(".compose-handle");
    const start = await dialog.boundingBox(),
      title = await handle.boundingBox();
    await page.mouse.move(title.x + 12, title.y + 12);
    await page.mouse.down();
    await page.mouse.move(title.x - 70, title.y - 24, { steps: 4 });
    await page.mouse.up();
    assert.ok((await dialog.boundingBox()).x < start.x - 60);
    await handle.press("ArrowRight");
    assert.ok((await dialog.boundingBox()).x > start.x - 72);
    const moved = await dialog.boundingBox();
    await page.reload();
    await dialog.getByLabel("Subject", { exact: true }).waitFor();
    assert.equal(await dialog.getAttribute("data-mode"), "floating");
    const restored = await dialog.boundingBox();
    assert.ok(Math.abs(moved.x - restored.x) < 1 && Math.abs(moved.y - restored.y) < 1);
    await dialog.getByRole("button", { name: "Pin compose to bottom" }).click();
    await page.waitForURL(origin + "/mailboxes/" + box + "/inbox");
    const pinned = await dialog.boundingBox();
    assert.equal(Math.round(pinned.y + pinned.height), 850);
    assert.equal(await dialog.evaluate((el) => el.matches(":modal")), false);
    await page.getByRole("link", { name: "All inboxes", exact: true }).click();
    await page.getByRole("list", { name: "Conversations" }).getByRole("link").first().click();
    await page.locator("article .body").waitFor();
    await dialog.getByLabel("Message", { exact: true }).fill("Keep these notes while I read.");
    await dialog.getByRole("button", { name: "Minimize compose" }).click();
    const tab = page.getByRole("button", { name: "Restore draft: " + subject });
    await tab.waitFor();
    await page.reload();
    await tab.waitFor();
    assert.equal(await dialog.count(), 0);
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    await dialog.getByLabel("To", { exact: true }).waitFor();
    await page.reload();
    await dialog.getByLabel("To", { exact: true }).waitFor();
    assert.ok(await tab.isVisible());
    await dialog.getByRole("button", { name: "Close compose" }).click();
    await tab.click();
    assert.equal(
      await dialog.getByLabel("Message", { exact: true }).inputValue(),
      "Keep these notes while I read.",
    );
    await dialog.getByRole("button", { name: "Expand compose" }).click();
    assert.ok(await dialog.evaluate((el) => el.matches(":modal")));
    assert.ok((await dialog.boundingBox()).width > pinned.width);
    await page.reload();
    await dialog.getByLabel("Subject", { exact: true }).waitFor();
    assert.equal(await dialog.getAttribute("data-mode"), "expanded");
    await dialog.getByRole("button", { name: "Restore compose size" }).click();
    await dialog.getByRole("button", { name: "Unpin compose" }).click();
    await page.setViewportSize({ width: 320, height: 680 });
    const phone = await dialog.boundingBox();
    assert.ok(phone.x >= 0 && phone.x + phone.width <= 320);
    await dialog.getByRole("button", { name: "Minimize compose" }).click();
    await tab.click();
    await dialog.getByRole("button", { name: "Close compose" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.reload();
    await page.locator("article .body").waitFor();
    assert.equal(await dialog.count(), 0);
    assert.equal(await tab.count(), 0);
    console.log(
      "PASS · drag and keyboard positioning, default dock, reload at dragged coordinates, minimized and expanded drafts, multiple drafts, phone restore and close",
    );
  } finally {
    await page.setViewportSize(original);
  }
}
