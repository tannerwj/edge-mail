import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { ulid } from "ulid";
export function hookReceiver() {
  const expected = new Map(),
    keys = new Map(),
    calls = [];
  async function receive(req) {
    const version = Number(req.headers.get("edge-mail-key-version"));
    const time = req.headers.get("edge-mail-timestamp"),
      id = req.headers.get("edge-mail-delivery");
    const body = await req.text();
    assert.equal(req.url, "https://hooks.example.test/events?tenant=fiction");
    assert.equal(
      req.headers.get("edge-mail-signature"),
      "sha256=" +
        createHmac("sha256", keys.get(version))
          .update(time + "." + id + "." + body)
          .digest("hex"),
    );
    const event = JSON.parse(body);
    assert.equal(event.id, id);
    assert.equal(event.event, expected.get(event.detail) || "message.received");
    assert.deepEqual(Object.keys(event).sort(), [
      "created",
      "detail",
      "event",
      "id",
      "mailbox",
      "resource",
    ]);
    calls.push({ id, version });
    return new Response(null, { status: calls.length === 1 ? 503 : 204 });
  }
  return { keys, calls, receive, expected };
}
export async function exerciseHooks(worker, jwt, db, receiver, push) {
  const host = "http://127.0.0.1";
  const box = await db
    .prepare("SELECT id FROM mailboxes WHERE address='push@example.test'")
    .first("id");
  const headers = {
    origin: host,
    "cf-access-jwt-assertion": jwt,
    "content-type": "application/json",
  };
  async function request(path, data, token) {
    const r = await worker.dispatchFetch(host + path, {
      method: data ? "POST" : "GET",
      headers: token
        ? { authorization: "Bearer " + token, "content-type": "application/json" }
        : headers,
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    assert.equal(r.status, 200, path + " " + (!r.ok ? await r.text() : ""));
    return r.json();
  }
  const { token, id: grant } = await request("/api/grants", {
    name: "Webhook test",
    scopes: ["mail.write"],
    days: 1,
    boxes: [box],
  });
  const { id, secret } = await request(
    "/v1/webhook_create",
    {
      mailbox: box,
      url: "https://hooks.example.test/events?tenant=fiction",
      events: ["message.received"],
    },
    token,
  );
  receiver.keys.set(1, secret);
  const [stored] = (
    await db.prepare("SELECT endpoint,keydata FROM webhooks WHERE id=?").bind(id).all()
  ).results;
  assert.ok(!stored.endpoint.includes("tenant") && !stored.keydata.includes(secret));
  assert.ok((await request("/api/notices")).some((n) => n.mailbox_id === box));
  const store = await worker.getR2Bucket("MAIL"),
    service = await worker.getWorker();
  async function receive(subject) {
    const raw =
      "From: hello@fixture.test\r\nTo: push@example.test\r\nSubject: " +
      subject +
      "\r\n\r\nFixture body.";
    const receiptId = ulid(),
      key = "raw/" + box + "/2026/11/" + receiptId + ".eml";
    const receipt = {
      id: receiptId,
      mailbox: box,
      kind: "primary",
      from: "hello@fixture.test",
      to: "push@example.test",
      matched: "push@example.test",
      tag: null,
      auth: {},
      at: new Date().toISOString(),
    };
    await store.put(key, raw, { customMetadata: { receipt: JSON.stringify(receipt) } });
    const result = await service.queue("fixture-ingest", [
      { id: receiptId, timestamp: new Date(), body: key, attempts: 1 },
    ]);
    assert.equal(result.outcome, "ok");
    assert.equal(result.retryMessages.length, 0);
  }
  const tick = async () => {
    const result = await service.scheduled({ cron: "*/5 * * * *" });
    assert.equal(result.outcome, "ok");
  };
  await receive("Paper receipt");
  await tick();
  assert.equal(receiver.calls.length, 1);
  const rotated = await request("/v1/webhook_rotate", { mailbox: box, id }, token);
  receiver.keys.set(2, rotated.secret);
  await db.prepare("UPDATE webhook_jobs SET due=0 WHERE hook=? AND state='pending'").bind(id).run();
  await tick();
  assert.deepEqual(receiver.calls[1], receiver.calls[0]);
  await receive("Replacement receipt");
  await tick();
  assert.equal(receiver.calls[2].version, 2);
  const log = await request("/api/mailboxes/" + box + "/webhooks");
  assert.equal(log.deliveries.filter((d) => d.state === "delivered").length, 2);
  const targets = await request("/api/mailboxes/" + box + "/rule-targets");
  const user = targets.people[0].id;
  const device = await request("/api/notifications", {
    action: "subscribe",
    new_mail: true,
    subscription: push.sub,
  });
  const before = push.received.length;
  const held = await request("/api/mailboxes/" + box + "/rules", {
    scope: "mailbox",
    revision: 0,
    document: {
      name: "Notify the filing agent",
      enabled: true,
      stop: false,
      order: 20,
      condition: { field: "subject", op: "equals", value: "Filing request" },
      actions: [
        { kind: "notify", target: user },
        { kind: "agent_notify", target: id },
        { kind: "webhook", target: id },
      ],
    },
  });
  receiver.expected.set(held.id, "rule.matched");
  await receive("Filing request");
  await tick();
  assert.equal(receiver.calls.length, 5);
  assert.deepEqual(
    push.received.slice(before).map((item) => item.payload.topic),
    ["rule"],
  );
  await request("/api/notifications", { action: "remove", id: device.id });
  const ruleEvent = await db
    .prepare("SELECT state FROM webhook_jobs WHERE hook=? AND kind='rule.matched' AND detail=?")
    .bind(id, held.id)
    .all();
  assert.deepEqual(ruleEvent.results, [{ state: "delivered" }]);
  await receive("Last receipt");
  await request("/api/grants/" + grant + "/revoke", {});
  await tick();
  assert.equal(receiver.calls.length, 5);
  assert.equal(
    await db
      .prepare("SELECT count(*) n FROM webhook_jobs WHERE hook=? AND state='cancelled'")
      .bind(id)
      .first("n"),
    1,
  );
  console.log(
    "PASS · an agent registers a signed webhook, the receiver verifies retries and key rotation, and parent revocation cancels the queued event",
  );
}
