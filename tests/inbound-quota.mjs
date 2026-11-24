import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
export async function checkInboundQuota({ origin, page, start, json, request, sql }) {
  await start("owner@example.test");
  const { id } = await json("/api/mailboxes", {
    name: "Receiving budgets",
    address: "receiving-budget@mail.test",
  });
  const path = "/api/mailboxes/" + id + "/quota",
    inbox = "/api/mailboxes/" + id + "/messages",
    to = "receiving-budget@mail.test";
  const unlimited = {
    r2_soft: null,
    r2_hard: null,
    d1_soft: null,
    d1_hard: null,
    sender_rate: null,
    recipient_rate: null,
  };
  await page.goto(origin + "/settings/operations");
  await page.getByText("Mailbox storage and inbound limits", { exact: true }).click();
  await page.getByLabel("Mailbox to limit").selectOption(id);
  await page.getByLabel("Deliveries per sender per minute").fill("1");
  await page.getByLabel("Deliveries per address per minute").fill("2");
  await page.getByRole("button", { name: "Save mailbox limits" }).click();
  await page.getByText("Mailbox limits saved.", { exact: true }).waitFor();
  const send = async (mark, from) =>
    fetch(origin + "/cdn-cgi/local/email?" + new URLSearchParams({ from, to }), {
      method: "POST",
      body: [
        "From: " + from,
        "To: " + to,
        "Message-ID: <" + mark + "@quota.test>",
        "Subject: " + mark,
        "",
        "Fictional delivery.",
      ].join("\r\n"),
    });
  for (const [subject, sender] of [
    ["accepted-one", "a@fiction.test"],
    ["sender-limited", "a@fiction.test"],
    ["accepted-two", "b@fiction.test"],
    ["address-limited", "c@fiction.test"],
  ])
    await (await send(subject, sender)).text();
  const count = () => sql("SELECT count(*) n FROM quota_reservations WHERE box='" + id + "'")[0].n;
  assert.equal(count(), 2);
  for (let i = 0; i < 80 && (await json(inbox)).messages.length < 2; i++) await sleep(100);
  assert.deepEqual((await json(inbox)).messages.map((m) => m.subject).sort(), [
    "accepted-one",
    "accepted-two",
  ]);
  const usage = await json(path, { ...unlimited, d1_soft: 2000, d1_hard: 4980 });
  assert.equal(usage.estimated_d1_bytes, 4980);
  await (await send("index-full", "d@fiction.test")).text();
  assert.equal(count(), 2);
  await json(path, { ...unlimited, r2_hard: 127 });
  await (await send("storage-full", "e@fiction.test")).text();
  assert.equal(count(), 2);
  assert.equal((await request(path, { ...unlimited, d1_soft: 4000, d1_hard: 3000 })).status, 400);
  sql("UPDATE quota_usage SET measured=0 WHERE box='" + id + "'");
  const measured = await json(path, { ...unlimited, r2_soft: 1 });
  assert.ok(measured.r2_bytes > 127);
  assert.ok((await json("/api/limits")).alerts.some((a) => a.code === "mailbox_soft_quota"));
  sql(
    "CREATE TRIGGER fixture_quota_full BEFORE INSERT ON quota_reservations BEGIN SELECT RAISE(ABORT,'SQLITE_FULL'); END",
  );
  try {
    assert.ok((await send("counter-full", "f@fiction.test")).ok);
    for (
      let i = 0;
      i < 80 && !(await json(inbox)).messages.some((m) => m.subject === "counter-full");
      i++
    )
      await sleep(100);
    assert.ok((await json(inbox)).messages.some((m) => m.subject === "counter-full"));
  } finally {
    sql("DROP TRIGGER fixture_quota_full");
  }
  await start("reader@example.test");
  assert.equal((await request(path)).status, 403);
  await start("owner@example.test");
  assert.equal(await json(path, unlimited), null);
  console.log(
    "PASS · owner sets sender and recipient caps in Settings, preserves accepted mail, enforces storage and index limits, measures stored mailbox objects and receives an alert",
  );
}
