import assert from "node:assert/strict";

export async function checkLargeList(page, origin, box) {
  const tab = await page
    .context()
    .browser()
    .newPage({ storageState: await page.context().storageState() });
  try {
    const count = process.env.EDGE_MAIL_SCROLL_BENCH === "1" ? 100000 : 400;
    const rows = Array.from({ length: count }, (_, i) => ({
      id: String(i + 1).padStart(26, "0"),
      sender: "fixture@example.test",
      subject: "Window fixture " + i,
      snippet: "Fictional receipt",
      received_at: "2025-01-02T00:00:00Z",
      is_read: 1,
      starred: 0,
      attachment_count: 0,
      folder: "inbox",
      message_count: 1,
    }));
    await tab.setViewportSize({ width: 1300, height: 860 });
    await tab.route("**/api/mailboxes/" + box + "/messages?*", (r) =>
      r.fulfill({ json: { messages: rows, next: null } }),
    );
    await tab.goto(origin + "/mailboxes/" + box + "/inbox");
    const pane = tab.getByRole("separator", { name: "Conversation list width" });
    await pane.focus();
    await pane.press("ArrowRight");
    assert.equal(await pane.getAttribute("aria-valuenow"), "44");
    await tab.reload();
    await pane.waitFor();
    assert.equal(await pane.getAttribute("aria-valuenow"), "44");
    const list = tab.getByRole("list", { name: "Conversations" });
    await list.getByText("Window fixture 0", { exact: true }).waitFor();
    const timing = await list.evaluate(async (host) => {
      const times = [];
      let prev = 0;
      for (let i = 0; i < 60; i++) {
        const time = await new Promise(requestAnimationFrame);
        if (prev) times.push(time - prev);
        prev = time;
        host.scrollTop = ((host.scrollHeight - host.clientHeight) * i) / 59;
      }
      return times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];
    });
    await list.getByText("Window fixture " + (count - 1), { exact: true }).waitFor();
    assert.ok(
      (await list.getByRole("listitem").count()) < 40,
      "Rendering grew beyond the visible window",
    );
    const last = list.getByRole("listitem").last();
    assert.equal(await last.getAttribute("aria-posinset"), String(count));
    assert.equal(await last.getAttribute("aria-setsize"), String(count));
    console.log(
      "PASS · owner resized and reloaded the list, then scrolled " +
        count +
        " loaded conversations with fewer than 40 mounted rows; p95 frame interval " +
        timing.toFixed(1) +
        " ms",
    );
  } finally {
    await tab.close();
  }
}
