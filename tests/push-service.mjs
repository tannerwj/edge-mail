import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { jwtVerify, importJWK } from "jose";
import ece from "http_ece";
// The provider boundary receives the same VAPID and encrypted bytes as a push service.
export function pushReceiver() {
  const keys = createECDH("prime256v1"),
    pub = keys.generateKeys().toString("base64url"),
    auth = randomBytes(16);
  const endpoint = "https://fcm.googleapis.com/fcm/send/" + randomBytes(24).toString("base64url");
  const sub = { endpoint, keys: { auth: auth.toString("base64url"), p256dh: pub } };
  const received = [];
  async function receive(req) {
    assert.equal(req.url, endpoint);
    assert.equal(req.method, "POST");
    const header = req.headers.get("authorization") || "";
    const match = /^vapid t=([^,]+),\s*k=([^, ]+)$/.exec(header);
    assert.ok(match);
    const raw = Buffer.from(match[2], "base64url");
    const key = await importJWK(
      {
        kty: "EC",
        crv: "P-256",
        x: raw.subarray(1, 33).toString("base64url"),
        y: raw.subarray(33).toString("base64url"),
      },
      "ES256",
    );
    await jwtVerify(match[1], key, { audience: new URL(endpoint).origin, algorithms: ["ES256"] });
    const bytes = Buffer.from(await req.arrayBuffer());
    assert.equal(bytes.length, 4096);
    const payload = JSON.parse(
      ece.decrypt(bytes, { version: "aes128gcm", privateKey: keys, authSecret: auth }),
    );
    received.push({ payload, publicKey: match[2] });
    return new Response(null, { status: 201 });
  }
  return { sub, receive, received };
}
export async function exercisePush(worker, bearer, receiver, db) {
  const host = "http://127.0.0.1";
  const request = async (path, input, token) => {
    const r = await worker.dispatchFetch(host + path, {
      method: input ? "POST" : "GET",
      headers: {
        origin: host,
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : { "cf-access-jwt-assertion": bearer }),
      },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    assert.equal(r.status, 200, path + " " + (!r.ok ? await r.text() : ""));
    return r.json();
  };
  const { id: box } = await request("/api/mailboxes", {
    name: "Push fixture",
    address: "push@example.test",
  });
  const info = await request("/api/notifications");
  const device = await request("/api/notifications", {
    action: "subscribe",
    new_mail: false,
    subscription: receiver.sub,
  });
  const row = await db
    .prepare("SELECT ciphertext FROM push_devices WHERE id=?")
    .bind(device.id)
    .first();
  assert.ok(row && !row.ciphertext.includes(receiver.sub.endpoint));
  const { token } = await request("/api/grants", {
    name: "Vacation assistant",
    scopes: ["mail.write"],
    days: 1,
    boxes: [box],
  });
  const change = {
    mailbox: box,
    revision: 0,
    document: {
      name: "Away",
      enabled: true,
      order: 1,
      stop: false,
      condition: { field: "from", op: "equals", value: "reader@fixture.test" },
      actions: [{ kind: "auto_reply", days: 7, text: "Returning soon." }],
    },
  };
  await request("/v1/rule_upsert", { ...change, dry_run: true }, token);
  assert.deepEqual(await request("/api/notices"), []);
  const rule = await request("/v1/rule_upsert", change, token);
  const alerts = await request("/api/notices");
  assert.equal(alerts[0]?.audit_id, rule.audit_id);
  assert.equal(receiver.received.length, 1);
  assert.deepEqual(receiver.received[0], {
    publicKey: info.publicKey,
    payload: {
      topic: "egress",
      message: "A connected agent changed how mail leaves your mailbox.",
      box,
    },
  });
  await request("/api/mailboxes/" + box + "/activity/" + rule.audit_id, {});
  await request("/api/notices/" + rule.audit_id + "/ack", {});
  assert.deepEqual(await request("/api/notices"), []);
  await request("/api/notifications", { action: "remove", id: device.id });
  assert.deepEqual((await request("/api/notifications")).devices, []);
  console.log(
    "PASS · scoped agent egress triggers an owner notice, authenticated and independently decrypted Web Push, acknowledgement, undo and device removal",
  );
}
