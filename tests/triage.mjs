import { checkMailLayout, checkInboxScopes } from "./mail-layout.mjs";
import { checkLargeList } from "./large-list.mjs";
import assert from "node:assert/strict";
export async function checkTriage({
  json,
  request,
  start,
  list,
  detail,
  privateBox,
  page,
  origin,
  box,
}) {
  const found = async (expression) =>
    (await json(list + "?" + new URLSearchParams({ q: expression }))).messages.map((m) => m.id);
  const message = (await json(detail)).id;
  for (const q of [
    '"delivery window"',
    "from:customer to:orders@mail.test",
    "domain:outside.test subject:question",
    "is:unread -missing larger:100",
    "in:inbox cc:billing@outside.test",
  ]) {
    assert.deepEqual(await found(q), [message], q);
  }
  assert.deepEqual(await found('-"delivery window"'), []);
  assert.equal((await request(list + "?q=is:invalid")).status, 400);
  assert.equal((await request(detail, { field: "starred", value: true })).status, 403);
  const bulk = "/api/mailboxes/" + box + "/triage";
  const mark = { ids: [message], field: "is_read", value: true };
  assert.equal((await request(bulk, mark)).status, 403);
  assert.equal((await json(detail)).is_read, 0);
  assert.equal(
    (await request("/api/mailboxes/" + privateBox + "/messages?q=in:anywhere")).status,
    404,
  );
  await start("box-editor@example.test");
  assert.deepEqual(await json(bulk, { ...mark, dry_run: true }), { ok: true, matched: 1 });
  assert.equal(
    (await request(bulk, { ...mark, ids: [message, "01000000000000000000000000"] })).status,
    404,
  );
  assert.equal((await json(detail)).is_read, 0);
  const base = origin + "/?box=" + box;
  await page.goto(base);
  await page.getByRole("heading", { name: "Inbox", exact: true }).waitFor();
  await checkMailLayout(page, base);
  await checkLargeList(page, origin, box);
  assert.equal(new URL(page.url()).pathname, "/mailboxes/" + box + "/inbox");
  await page.keyboard.press("Control+k");
  await page.getByLabel("Find a command").press("ArrowDown");
  await page.getByRole("option", { name: /Previous message/, selected: true }).waitFor();
  await page.getByLabel("Find a command").fill("Search mailbox");
  await page.getByLabel("Find a command").press("Enter");
  assert.ok(await page.getByLabel("Search mailbox").evaluate((e) => e === document.activeElement));
  await page.keyboard.type("jre#");
  assert.equal(await page.getByLabel("Search mailbox").inputValue(), "jre#");
  await page.getByLabel("Search mailbox").fill("");
  await page.getByRole("button", { name: "Select messages", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select message Delivery question" }).check();
  await page.getByLabel("Label for selected messages").fill("Batch selection");
  await page.getByRole("button", { name: "Apply label" }).click();
  await page.getByRole("button", { name: "Select messages", exact: true }).waitFor();
  assert.deepEqual(await found('label:"Batch selection"'), [message]);
  await page.getByRole("link", { name: /Delivery question/ }).click();
  assert.equal(new URL(page.url()).pathname, "/mailboxes/" + box + "/inbox/messages/" + message);
  await page.reload();
  await page.getByRole("button", { name: "Star", exact: true }).click();
  await page.getByRole("button", { name: "Unstar", exact: true }).waitFor();
  const unread = page.getByRole("navigation", { name: "Mailboxes" }).getByLabel("1 unread");
  await unread.waitFor();
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await unread.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Mark unread", exact: true }).click();
  await unread.waitFor();
  await page.getByRole("button", { name: "Select messages", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select message Delivery question" }).check();
  await page.getByRole("button", { name: "Mark selected read" }).click();
  await unread.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Mark unread", exact: true }).waitFor();
  await page.getByText("Move or label", { exact: true }).click();
  await page.getByLabel("Label name").fill("Follow up");
  await page.getByRole("button", { name: "Add label" }).click();
  await page.getByRole("button", { name: "Remove label Follow up" }).waitFor();
  await page.getByLabel("Move to").selectOption("archive");
  await page.waitForFunction(() => document.querySelector("select")?.value === "archive");
  await page.goto(base);
  await page.getByText("No messages yet.").waitFor();
  await page.getByLabel("Search mailbox").fill('label:"Follow up" is:starred in:archive');
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("link", { name: /Delivery question/ }).waitFor();
  await page.getByRole("link", { name: /Delivery question/ }).click();
  const searchURL = new URL(page.url());
  assert.equal(searchURL.search, "");
  assert.equal(
    decodeURIComponent(searchURL.pathname),
    "/mailboxes/" + box + '/search/~label:"Follow up" is:starred in:archive/messages/' + message,
  );
  await page.reload();
  await page.getByRole("heading", { name: "Delivery question" }).waitFor();
  const removeFilter = page.getByRole("link", { name: "Remove filter is:starred", exact: true });
  assert.equal(
    decodeURIComponent(await removeFilter.getAttribute("href"))
      .split("/")
      .at(-1),
    '~label:"Follow up" in:archive',
  );
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/searches") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save this search" }).click();
  const result = await saved;
  assert.equal(result.status(), 200, await result.text());
  await page.getByRole("button", { name: "Remove saved search" }).waitFor();
  await page.getByRole("link", { name: "All inboxes", exact: true }).click();
  await page.getByRole("heading", { name: "All inboxes", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/inboxes");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /Preferences/ }).click();
  await page.getByLabel("Color scheme").selectOption("dark");
  await page.getByLabel("Reading layout").selectOption("compact");
  await page.reload();
  assert.equal(await page.getByLabel("Reading layout").inputValue(), "compact");
  assert.equal(
    await page.locator("html").evaluate((el) => getComputedStyle(el).colorScheme),
    "dark",
  );
  await start("reader@example.test");
  assert.deepEqual((await json("/api/searches?box=" + box)).searches, []);
  assert.equal((await request("/api/searches?box=" + privateBox)).status, 404);
  assert.ok((await json("/api/inbox")).messages.every((m) => m.mailbox_id === box));
  assert.deepEqual(await found('is:read label:"Follow up" in:archive'), [message]);
  assert.deepEqual(await found("in:inbox"), []);
  await start("box-editor@example.test");
  for (const folder of ["spam", "trash"]) {
    await json(detail, { field: "folder", value: folder });
    assert.deepEqual(await found('"delivery window" from:customer'), []);
    assert.deepEqual(await found("in:" + folder), [message]);
    assert.deepEqual(await found("in:anywhere"), [message]);
  }
  await json(detail, { field: "folder", value: "inbox" });
  const mailbox = (await json("/api/workspace")).mailboxes.find((b) => b.id === box);
  await checkInboxScopes(page, origin, box, mailbox.domain_id);
  console.log(
    "PASS · scoped search, shared read/star/labels/folders, reader isolation, browser triage and persistent layout",
  );
}
