import { checkComposeWindow } from "./compose-window.mjs";
import assert from "node:assert/strict";
export async function checkDrafts({ page, box, origin, root, json, start, request }) {
  await page.goto(origin + "/?" + new URLSearchParams({ box, message: root }));
  const reply = page.getByRole("button", { name: "Reply all", exact: true });
  await reply.waitFor();
  const behind = page.url();
  await reply.click();
  const modal = page.getByRole("dialog", { name: "Compose" });
  await modal.getByLabel("To", { exact: true }).waitFor();
  assert.equal(await modal.getAttribute("data-mode"), "pinned");
  await modal.getByRole("button", { name: "Options for customer@outside.test in To" }).waitFor();
  await modal.getByRole("button", { name: "Options for billing@outside.test in Cc" }).waitFor();
  await page.getByLabel("Bcc", { exact: true }).fill("private@outside.test");
  await page.getByLabel("Message", { exact: true }).fill("Reply after reviewing the order.");
  await page
    .getByRole("status")
    .getByText("Saved", { exact: true })
    .or(page.getByText("Saved", { exact: true }))
    .first()
    .waitFor();
  const url = page.url();
  const id = new URL(url).pathname.split("/").at(-1),
    path = "/api/mailboxes/" + box + "/drafts/" + id;
  await page.reload();
  assert.equal(
    await page.getByLabel("Message", { exact: true }).inputValue(),
    "Reply after reviewing the order.",
  );
  await modal.getByLabel("Message", { exact: true }).fill("Latest edit on close.");
  await modal.press("Escape");
  await page.waitForURL(behind);
  assert.equal((await json(path)).content.body, "Latest edit on close.");
  await page.goto(url);
  await modal.getByLabel("Message", { exact: true }).waitFor();
  await modal.getByRole("button", { name: "Close compose" }).click();
  await page.waitForURL(origin + "/mailboxes/" + box + "/drafts");
  const before = await json(path);
  const next = {
    revision: before.revision,
    content: { ...before.content, body: "Second version" },
  };
  const updated = await json(path, next);
  assert.equal(updated.revision, before.revision + 1);
  assert.equal((await json(path, next)).revision, updated.revision);
  assert.equal(
    (await request(path, { ...next, content: { ...next.content, body: "Stale edit" } })).status,
    409,
  );
  await checkComposeWindow(page, origin, box);
  await start("box-owner@example.test");
  assert.equal((await request(path)).status, 404);
  await start("reader@example.test");
  assert.equal((await request(path)).status, 404);
  assert.equal((await request("/api/mailboxes/" + box + "/drafts", { id })).status, 403);
  await start("box-editor@example.test");
  console.log(
    "PASS · reply-all, private Bcc, draft autosave and reload, idempotent retry and stale revision rejection",
  );
}
