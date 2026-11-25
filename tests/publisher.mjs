import assert from "node:assert/strict";
export function publisher() {
  let count = 0;
  return {
    count: () => count,
    async receive(req) {
      count++;
      assert.equal(req.method, "POST");
      assert.equal(await req.text(), "List-Unsubscribe=One-Click");
      for (const key of ["cookie", "authorization", "cf-access-jwt-assertion", "referer"])
        assert.equal(req.headers.get(key), null);
      return new Response(null, { status: 204 });
    },
  };
}
export async function exerciseList(worker, jwt, db, service) {
  const box = await db
    .prepare("SELECT id FROM mailboxes WHERE address='push@example.test'")
    .first("id");
  const base = "http://127.0.0.1/api/mailboxes/" + box;
  const headers = { "cf-access-jwt-assertion": jwt, origin: "http://127.0.0.1" };
  const host = "subscriptions.publisher.test";
  const eml = [
    "Authentication-Results: mx.cloudflare.net; dkim=pass header.d=publisher.test header.s=n header.b=0123456789",
    "DKIM-Signature: v=1; d=publisher.test; s=n; h=from:list-unsubscribe-post:list-unsubscribe; b=0123456789abcdef",
    "From: news@publisher.test",
    "Subject: Fictional newsletter",
    "List-Unsubscribe: <https://" + host + "/unique>",
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    "",
    "Fictional newsletter body.",
  ].join("\r\n");
  const saved = await worker.dispatchFetch(base + "/archive", {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "message/rfc822",
      "content-length": String(Buffer.byteLength(eml)),
    },
    body: eml,
  });
  assert.equal(saved.status, 200);
  const id = await db
    .prepare("SELECT id FROM messages WHERE mailbox_id=? AND subject='Fictional newsletter'")
    .bind(box)
    .first("id");
  async function details() {
    const r = await worker.dispatchFetch(base + "/messages/" + id, { headers });
    assert.equal(r.status, 200);
    return r.json();
  }
  async function leave(confirm) {
    return worker.dispatchFetch(base + "/unsubscribe/" + id, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ confirm }),
    });
  }
  assert.equal((await details()).unsubscribeHost, null);
  assert.equal((await leave(host)).status, 403);
  // Model the Email Routing authentication boundary for the same original MIME after proving that an import is ineligible.
  await db
    .prepare(
      "UPDATE deliveries SET kind='primary',received_at='2026-11-20T12:00:00.000Z',auth=? WHERE mailbox_id=? AND message_id=?",
    )
    .bind(JSON.stringify({ dkim: "pass" }), box, id)
    .run();
  assert.equal((await details()).unsubscribeHost, host);
  assert.equal((await leave("different.test")).status, 403);
  assert.equal(service.count(), 0);
  const reply = await leave(host);
  assert.equal(reply.status, 200, await reply.text());
  assert.equal(service.count(), 1);
  console.log(
    "PASS · viewing list mail sends no request, import and wrong confirmation are denied, and explicit consent posts once without credentials to the publisher",
  );
}
