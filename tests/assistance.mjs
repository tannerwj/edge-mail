import assert from "node:assert/strict";
export async function checkAssistance({
  start,
  request,
  json,
  page,
  box,
  origin,
  privateBox,
  detail,
  sql,
}) {
  const route = "/api/mailboxes/" + box + "/assistant";
  await start("owner@example.test");
  assert.deepEqual(await json(route), { available: false, enabled: false });
  await start("box-owner@example.test", true);
  assert.equal(
    (await request(route, { action: "summary", message: detail.split("/").at(-1) })).status,
    403,
  );
  await page.goto(origin + "/mailboxes/" + box + "/inbox");
  await page.getByText("Mailbox assistance", { exact: true }).click();
  await page.getByRole("button", { name: "Allow mailbox assistance" }).click();
  await page.getByLabel("Describe a search or label rule").fill("delivery updates");
  await page.getByRole("button", { name: "Suggest search", exact: true }).click();
  const link = page.getByRole("link", { name: "Run suggested search" });
  await link.waitFor();
  assert.ok((await link.getAttribute("href")).includes("/search/"));
  await page.getByRole("button", { name: "Suggest label rule" }).click();
  await page.getByRole("button", { name: "Create this label rule" }).click();
  await page.getByText("Mailbox label rule saved.").waitFor();
  await start("reader@example.test", true);
  assert.equal((await request(route, { action: "configure", enabled: true })).status, 403);
  assert.equal((await request("/api/mailboxes/" + privateBox + "/assistant")).status, 404);
  const message = detail.split("/").at(-1);
  for (const action of ["summary", "draft", "spam", "category"]) {
    const result = await json(route, { action, message });
    assert.equal(
      result.text,
      action === "category" ? "Updates" : "The sender asks about a delivery window.",
    );
  }
  sql("UPDATE mailbox_ai SET calls=30 WHERE mailbox_id='" + box + "'");
  assert.equal((await request(route, { action: "search", prompt: "invoice" })).status, 429);
  await start("box-owner@example.test", true);
  await json(route, { action: "configure", enabled: false });
  assert.equal((await request(route, { action: "summary", message })).status, 403);
  console.log(
    "PASS · mailbox owner enables Workers AI and confirms a label rule, readers can request bounded suggestions only for shared threads, and disabling assistance stops further use",
  );
}
