import assert from "node:assert/strict";
export async function checkErasure({
  page,
  start,
  origin,
  box,
  json,
  request,
  sql,
  wrangler,
  state,
}) {
  await start("owner@example.test");
  const raw =
    "From: purge@fiction.test\r\nTo: support@mail.test\r\nDate: Wed, 20 May 2020 12:00:00 +0000\r\nMessage-ID: <erase-example@fiction.test>\r\nSubject: Erasable archive\r\n\r\nMaritime parcel archive.";
  const archive = "/api/mailboxes/" + box + "/archive";
  const put = () =>
    fetch(origin + archive, {
      method: "POST",
      headers: { origin, "content-type": "message/rfc822" },
      body: raw,
    });
  assert.equal((await put()).status, 200);
  const m = (await json("/api/mailboxes/" + box + "/messages?q=Maritime")).messages[0];
  assert.ok(m);
  const before = sql(
    "SELECT d.raw_key,m.body_key FROM deliveries d JOIN messages m ON m.id=d.message_id WHERE m.id='" +
      m.id +
      "'",
  )[0];
  const check = (key) =>
    wrangler([
      "r2",
      "object",
      "get",
      "edge-mail-receipts/" + key,
      "--local",
      "--persist-to",
      state,
      "--pipe",
    ]);
  assert.match(check(before.body_key), /Maritime parcel/);
  assert.match(check(before.raw_key), /Erasable archive/);
  await json("/api/mailboxes/" + box + "/messages/" + m.id, { field: "folder", value: "trash" });
  await start("reader@example.test");
  assert.equal(
    (await request("/api/mailboxes/" + box + "/erase/" + m.id, { confirm: m.id })).status,
    403,
  );
  await start("owner@example.test");
  await page.goto(origin + "/mailboxes/" + box + "/trash/messages/" + m.id);
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await page.getByRole("button", { name: "Confirm permanent deletion" }).click();
  await page.waitForURL("**/trash");
  assert.equal((await request("/api/mailboxes/" + box + "/messages/" + m.id)).status, 404);
  assert.equal((await json("/api/mailboxes/" + box + "/messages?q=Maritime")).messages.length, 0);
  assert.equal((await put()).status, 200);
  assert.equal((await json("/api/mailboxes/" + box + "/messages?q=Maritime")).messages.length, 0);
  const receipt = await json("/api/mailboxes/" + box + "/erase/" + m.id, { confirm: m.id });
  assert.equal(receipt.hidden, 1);
  assert.equal((await json("/api/mailboxes/" + box + "/erasures/" + m.id)).id, m.id);
  assert.throws(() => check(before.body_key));
  assert.throws(() => check(before.raw_key));
  assert.ok(sql("SELECT count(*) n FROM erased_objects WHERE key='" + before.raw_key + "'")[0].n);
  console.log(
    "PASS · confirmed owner erasure removes inbox and FTS data, denies readers, records object cleanup and prevents historical replay",
  );
}
