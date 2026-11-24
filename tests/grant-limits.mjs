import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
export async function checkGrantLimits({ page, origin, start, box, json, request, sql }) {
  await start("owner@example.test");
  const grant = async (policy, name) =>
    json("/api/grants", { name, boxes: [box], days: 1, scopes: ["admin"], policy });
  const parent = await grant(
    { mode: "hold_all", daily_cap: 1, recipients: ["shop@fiction.test"], review_egress: true },
    "Purchasing assistant",
  );
  const call = async (token, op, args) =>
    fetch(origin + "/v1/" + op, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  const ok = async (token, op, args) => {
    const r = await call(token, op, args);
    assert.equal(r.status, 200, op + " " + (r.ok ? "" : await r.text()));
    return r.json();
  };
  const child = await ok(parent.token, "token_create", {
    name: "Purchasing helper",
    boxes: [box],
    scopes: ["mail.write"],
    days: 1,
  });
  const fixture = {
    mailbox: box,
    to: "shop@fiction.test",
    subject: "Fictional pickup clearance",
    body: "Confirming pickup at the customer desk.",
    idempotency_key: "approve-one",
    undoSeconds: 5,
  };
  assert.equal(
    (await ok(child.token, "mail_send", { ...fixture, dry_run: true })).would_hold,
    true,
  );
  assert.equal(
    (
      await call(child.token, "mail_send", {
        ...fixture,
        to: "other@fiction.test",
        idempotency_key: "no",
      })
    ).status,
    403,
  );
  const one = await ok(child.token, "mail_send", fixture),
    two = await ok(parent.token, "mail_send", {
      ...fixture,
      subject: "Fictional second collection",
      idempotency_key: "approve-two",
    });
  assert.equal(one.awaiting_approval, 1);
  assert.equal((await ok(child.token, "mail_send", fixture)).id, one.id);
  await start("reader@example.test");
  assert.equal((await request("/api/approvals/" + one.id, { approve: true })).status, 404);
  await start("owner@example.test");
  await page.goto(origin + "/settings/integrations");
  await page.getByText(/Fictional pickup clearance · Purchasing helper/).waitFor();
  await page.getByRole("link", { name: /Approvals ·/ }).click();
  await page.getByRole("heading", { name: "Approvals", exact: true }).waitFor();
  await page.getByText(/Fictional pickup clearance · Purchasing helper/).click();
  await page.getByRole("button", { name: "Approve request" }).click();
  await page
    .getByText(/Fictional pickup clearance · Purchasing helper/)
    .waitFor({ state: "hidden" });
  await json("/api/approvals/" + two.id, { approve: true });
  sql("UPDATE outbox SET due_ms=1 WHERE id IN('" + one.id + "','" + two.id + "')");
  await fetch(origin + "/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*");
  for (let i = 0; i < 50; i++) {
    const states = sql(
      "SELECT state,error_code FROM outbox WHERE id IN('" + one.id + "','" + two.id + "')",
    );
    if (
      states.some((x) => x.state === "sent") &&
      states.some((x) => x.error_code === "grant_daily_limit")
    )
      break;
    if (i === 49)
      assert.fail(
        "Approved requests did not share the ancestral daily limit: " + JSON.stringify(states),
      );
    await sleep(100);
  }
  const hookArgs = {
    mailbox: box,
    url: "https://receiver.example.org/approved",
    events: ["approval.requested"],
  };
  const hook = await ok(child.token, "webhook_create", hookArgs);
  assert.equal(hook.state, "pending");
  assert.equal(sql("SELECT count(*) n FROM webhooks WHERE id='" + hook.approval_id + "'")[0].n, 0);
  const approved = await json("/api/approvals/" + hook.approval_id, { approve: true });
  assert.equal(approved.id, hook.approval_id);
  assert.ok(approved.secret?.length > 20);
  await json("/api/mailboxes/" + box + "/webhooks", { action: "disable", id: approved.id });
  const deny = await grant({ mode: "drafts_only" }, "Draft writer");
  assert.equal(
    (await call(deny.token, "mail_send", { ...fixture, idempotency_key: "draft-only" })).status,
    403,
  );
  const known = await grant({ mode: "hold_new_recipients" }, "New recipients");
  const human = sql(
    "SELECT address FROM human_recipients WHERE mailbox_id='" +
      box +
      "' AND address!='shop@fiction.test' LIMIT 1",
  )[0];
  assert.ok(human?.address);
  assert.equal(
    (
      await ok(known.token, "mail_send", {
        ...fixture,
        dry_run: true,
        to: human.address,
        idempotency_key: "known",
      })
    ).would_hold,
    false,
  );
  assert.equal(
    (
      await ok(known.token, "mail_send", {
        ...fixture,
        dry_run: true,
        to: "never@fiction.test",
        idempotency_key: "new",
      })
    ).would_hold,
    true,
  );
  const pending = await ok(child.token, "mail_send", { ...fixture, idempotency_key: "revoked" });
  await json("/api/grants/" + parent.id + "/revoke", {});
  assert.equal(
    (await json("/api/approvals")).some((r) => r.id === pending.id),
    false,
  );
  console.log(
    "PASS · child grants inherit recipient and draft restrictions, human review, persistent egress review and a shared atomic daily limit",
  );
}
