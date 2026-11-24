import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
export async function checkOperatingLimits({ page, origin, start, box, json, request, sql }) {
  await start("reader@example.test");
  assert.equal((await request("/api/limits")).status, 403);
  assert.equal((await request("/api/suppressions")).status, 403);
  await start("admin@example.test");
  assert.equal(
    (await request("/api/limits", { action: "agent_writes", enabled: false })).status,
    403,
  );
  await start("owner@example.test");
  const { token } = await json("/api/grants", {
    name: "Dispatch checker",
    boxes: [box],
    days: 1,
    scopes: ["admin"],
  });
  const call = (name, args) =>
    fetch(origin + "/v1/" + name, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
  const letter = {
    mailbox: box,
    to: "billing@fiction.test",
    cc: "records@fiction.test",
    subject: "Fictional receipt for two contacts",
    body: "Receipt for two departments.",
    undoSeconds: 5,
    idempotency_key: "budgeted",
  };
  assert.equal((await call("metrics_summary", {})).status, 403);
  await page.goto(origin + "/settings/operations");
  await page.getByText("Delivery budgets and alerts", { exact: true }).click();
  await page.getByRole("button", { name: "Pause agent writes" }).click();
  await page.getByRole("button", { name: "Resume agent writes" }).waitFor();
  assert.equal((await call("mail_send", letter)).status, 403);
  assert.equal((await call("whoami", {})).status, 200);
  await page.getByRole("button", { name: "Resume agent writes" }).click();
  await page.getByRole("button", { name: "Pause agent writes" }).waitFor();
  const submitted = await call("mail_send", letter);
  assert.equal(submitted.status, 200);
  const { id } = await submitted.json();
  const used = (await json("/api/limits")).policy.monthly_used;
  await json("/api/limits", { action: "monthly", cap: Math.max(1, used + 1) });
  async function state(expected) {
    sql("UPDATE outbox SET due_ms=1 WHERE id='" + id + "'");
    await fetch(origin + "/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*");
    for (let i = 0; i < 50; i++) {
      const row = sql("SELECT state,error_code FROM outbox WHERE id='" + id + "'")[0];
      if (row.state === expected || row.error_code === expected) return;
      await sleep(100);
    }
    assert.fail("Expected budget decision " + expected);
  }
  await state("monthly_instance_limit");
  await json("/api/limits", { action: "user", email: "owner@example.test", cap: 1 });
  await json("/api/limits", { action: "monthly", cap: null });
  await state("user_daily_limit");
  assert.equal(sql("SELECT count(*) n FROM send_reservations WHERE item='" + id + "'")[0].n, 0);
  await json("/api/limits", { action: "user", email: "owner@example.test", cap: 100 });
  await state("sent");
  assert.equal(sql("SELECT units FROM send_reservations WHERE item='" + id + "'")[0].units, 2);
  const current = await json("/api/limits");
  assert.equal(current.account_analytics, null);
  assert.ok(current.alerts.some((alert) => alert.code === "complaint"));
  const a = current.alerts.find((alert) => alert.code === "uncertain");
  assert.ok(a);
  await json("/api/limits", { action: "ack", id: a.id });
  assert.ok(!(await json("/api/limits")).alerts.some((v) => v.id === a.id));
  console.log(
    "PASS · an owner pauses agent writes while reads continue; a two-recipient send waits for both budgets, reserves exactly two units, and the owner acknowledges an uncertain delivery",
  );
}
