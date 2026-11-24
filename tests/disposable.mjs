import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
export async function checkDisposable({ start, page, origin, box, json, request, sql }) {
  await start("owner@example.test");
  const path = "/api/mailboxes/" + box + "/disposable";
  await page.goto(origin + "/settings/mailboxes");
  await page.getByText("Disposable addresses", { exact: true }).click();
  await page.getByLabel("Receiving mailbox", { exact: true }).selectOption(box);
  await page.getByLabel("Address purpose").fill("Shop receipt");
  await page.getByLabel("Expires after (hours)").fill("24");
  await page.getByRole("button", { name: "Create disposable address" }).click();
  const revoke = page.getByRole("button", { name: /Revoke shop-receipt-/ });
  await revoke.waitFor();
  const dest = (await json(path)).addresses.find((a) => a.label === "Shop receipt").canonical;
  const send = async (to, from, mark) =>
    fetch(origin + "/cdn-cgi/local/email?" + new URLSearchParams({ from, to }), {
      method: "POST",
      body: [
        "From: " + from,
        "To: " + to,
        "Subject: Fictional disposable receipt " + mark,
        "Message-ID: <" + mark + "@disposable.test>",
        "",
        "Fixture",
      ].join("\r\n"),
    });
  assert.ok((await send(dest, "merchant@fiction.test", "receipt-one")).ok);
  for (
    let i = 0;
    i < 80 && !(await json(path)).addresses.find((a) => a.canonical === dest).first_sender;
    i++
  )
    await sleep(100);
  assert.equal(
    (await json(path)).addresses.find((a) => a.canonical === dest).first_sender,
    "merchant@fiction.test",
  );
  const domain = (await json("/api/workspace")).mailboxes.find((b) => b.id === box).domain_id;
  const unknown = "/api/domains/" + domain + "/unknown-recipients";
  await json(unknown, { mode: "deliver", mailbox: box });
  await revoke.click();
  await page.getByText("Shop receipt · Revoked", { exact: true }).waitFor();
  const table = (mark) =>
    sql(
      "SELECT d.kind FROM deliveries d JOIN messages m ON m.id=d.message_id WHERE m.subject='Fictional disposable receipt " +
        mark +
        "'",
    );
  await send(dest, "stranger@fiction.test", "blocked");
  await send(dest.replace("@", "+billing@"), "stranger@fiction.test", "blocked-plus");
  assert.ok((await send("unused@mail.test", "stranger@fiction.test", "wildcard")).ok);
  for (let i = 0; i < 50 && !table("wildcard").length; i++) await sleep(80);
  assert.deepEqual(table("wildcard"), [{ kind: "catch-all" }]);
  assert.deepEqual(table("blocked"), []);
  assert.deepEqual(table("blocked-plus"), []);
  const flood = await json(path, { action: "create", label: "burst", ttl_hours: 1 });
  sql(
    "UPDATE temporary_addresses SET window=unixepoch()/60,attempts=60 WHERE canonical='" +
      flood.address +
      "'",
  );
  await send(flood.address, "vendor@fiction.test", "flood");
  assert.equal(
    (await json(path)).addresses.find((a) => a.canonical === flood.address).reason,
    "flood",
  );
  assert.deepEqual(table("flood"), []);
  const exp = await json(path, { action: "create", label: "short", ttl_hours: 1 });
  sql("UPDATE temporary_addresses SET expires=1 WHERE canonical='" + exp.address + "'");
  await send(exp.address, "vendor@fiction.test", "expired");
  assert.deepEqual(table("expired"), []);
  await json(unknown, { mode: "reject" });
  await start("reader@example.test");
  assert.equal((await request(path, { action: "create", label: "reader" })).status, 403);
  console.log(
    "PASS · owner creates a temporary address, identifies its first sender and revokes it; expired and flood-suspended addresses stay closed even with an active catch-all",
  );
}
