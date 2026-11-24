import assert from "node:assert/strict";

export async function checkMailLayout(page, inbox) {
  const original = page.viewportSize();
  try {
    for (const width of [1150, 851, 650, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const mobile = width <= 650;
      const toggle = page.getByRole("button", { name: /navigation/ });
      if (mobile) {
        assert.ok(await page.getByRole("button", { name: "Compose", exact: true }).isVisible());
        await toggle.click();
      }
      for (const name of ["Drafts", "Scheduled", "Outbox"]) {
        const folder = page
          .getByRole("navigation", { name: "Folders" })
          .getByRole("link", { name, exact: true });
        const lines = await folder.evaluate((link) => {
          const label = [...link.childNodes].find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
          );
          const range = document.createRange();
          range.selectNodeContents(label);
          return range.getClientRects().length;
        });
        assert.equal(lines, 1, name + " must fit on one line at " + width + "px");
      }
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "Horizontal overflow at " + width,
      );
      if (mobile) {
        await toggle.press("Escape");
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        assert.ok(await toggle.evaluate((el) => el === document.activeElement));
      }
    }
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("link", { name: "Scheduled", exact: true }).click();
    await page.getByRole("heading", { name: "Scheduled" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Open navigation" }).getAttribute("aria-expanded"),
      "false",
    );
  } finally {
    await page.setViewportSize(original);
    await page.goto(inbox);
    await page.getByRole("heading", { name: "Inbox", exact: true }).waitFor();
  }
}

export async function checkInboxScopes(page, origin, box, domain) {
  const size = page.viewportSize();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [path, label] of [
      ["/inboxes", "All inboxes"],
      ["/domains/" + domain + "/inbox", "Domain inbox"],
    ]) {
      await page.goto(origin + path);
      const message = page
        .getByRole("list", { name: "Conversations" })
        .getByRole("link", { name: /Delivery question/ });
      await message.click();
      await page.locator("article .body").waitFor();
      assert.ok(new URL(page.url()).pathname.startsWith(path + "/" + box + "/messages/"));
      await page.reload();
      await page.locator("article .body").waitFor();
      await page.getByRole("link", { name: label, exact: true }).click();
      await message.waitFor();
      assert.equal(new URL(page.url()).pathname, path);
    }
  } finally {
    await page.setViewportSize(size);
  }
}
