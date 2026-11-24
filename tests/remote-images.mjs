import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const png = readFileSync("public/install/icon-192.png");
export function imageService() {
  let calls = 0;
  function receive(request) {
    assert.equal(request.url, "https://images.example.test/brand.png");
    for (const name of [
      "cookie",
      "authorization",
      "referer",
      "cf-access-jwt-assertion",
      "cf-access-client-secret",
    ])
      assert.equal(request.headers.get(name), null);
    calls++;
    return new Response(png, {
      headers: { "content-type": "image/png", "set-cookie": "vendor=private" },
    });
  }
  return { receive, calls: () => calls };
}
export async function exerciseImages(worker, jwt, db, service) {
  const box = await db
    .prepare("SELECT id FROM mailboxes WHERE address='push@example.test'")
    .first("id");
  const base = "http://127.0.0.1/api/mailboxes/" + box;
  const headers = { "cf-access-jwt-assertion": jwt, origin: "http://127.0.0.1" };
  const eml =
    'From: notice@example.test\r\nSubject: Image fixture\r\nContent-Type: text/html\r\n\r\n<p>Logo</p><img alt="Brand" src="https://images.example.test/brand.png">';
  const imported = await worker.dispatchFetch(base + "/archive", {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "message/rfc822",
      "content-length": String(Buffer.byteLength(eml)),
    },
    body: eml,
  });
  assert.equal(imported.status, 200);
  const id = await db.prepare("SELECT id FROM messages WHERE subject='Image fixture'").first("id");
  async function frame(mode) {
    const ticket = await worker.dispatchFetch(base + "/" + mode + "/" + id, { headers });
    assert.equal(ticket.status, 200);
    const { href } = await ticket.json();
    return (await worker.dispatchFetch(href)).text();
  }
  assert.doesNotMatch(await frame("formatted"), /<img /);
  const image = /<img[^>]* src="([^"]+)"/.exec(await frame("images"))?.[1];
  assert.equal(new URL(image).origin, "https://content.example.test");
  assert.equal(service.calls(), 0);
  const raster = await worker.dispatchFetch(image);
  assert.equal(raster.status, 200);
  assert.equal(raster.headers.get("content-type"), "image/png");
  assert.equal(raster.headers.get("set-cookie"), null);
  assert.deepEqual(Buffer.from(await raster.arrayBuffer()), png);
  assert.equal(service.calls(), 1);
  const remove = await worker.dispatchFetch(base + "/erase/" + id, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ confirm: id }),
  });
  assert.equal(remove.status, 200);
  assert.equal((await worker.dispatchFetch(image)).status, 404);
  assert.equal(service.calls(), 1);
  console.log(
    "PASS · the isolated image proxy returns the exact raster only after consent, strips vendor cookies, and invalidates its link on erasure",
  );
}
