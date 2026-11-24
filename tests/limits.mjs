import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

export async function checkLimits(origin, list, json) {
  const max = 25 * 1024 * 1024;
  const headers = [
    "From: customer@outside.test",
    "To: private@mail.test",
    "Subject: Attachment at the receive limit",
    "Message-ID: <large@outside.test>",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=limit",
    "",
    "--limit",
    "Content-Type: text/plain",
    "",
    "A large attachment.",
    "",
    "--limit",
    "Content-Type: application/octet-stream",
    'Content-Disposition: attachment; filename="sample.bin"',
    "Content-Transfer-Encoding: base64",
    "",
    "",
  ].join("\r\n");
  const line = "A".repeat(76) + "\r\n",
    end = "--limit--\r\n";
  const count = Math.floor((max - headers.length - end.length) / line.length);
  const body = (headers + line.repeat(count) + end).padEnd(max, " ");
  const url = origin + "/cdn-cgi/local/email?from=customer%40outside.test&to=private%40mail.test";
  const response = await fetch(url, { method: "POST", body });
  assert.ok(response.ok, "local 25 MiB receive " + response.status);
  await response.text();
  let messages = [];
  for (let tries = 0; tries < 120 && !messages.length; tries++) {
    await sleep(250);
    messages = (await json(list)).messages;
  }
  assert.equal(messages.length, 1, "25 MiB message visible");
  assert.equal(messages[0].attachment_count, 1);
  const rejected = await fetch(url, { method: "POST", body: body + "x" });
  const result = await rejected.text();
  assert.equal(rejected.status, 400);
  assert.match(result, /size is bigger than the production size limit of 25 MiB/);
  assert.equal((await json(list)).messages.length, 1);
}

export async function checkHtml(origin, list, json) {
  const source = [
    "Authentication-Results: unknown.test; spf=pass",
    "Authentication-Results: mx.cloudflare.net; spf=pass",
    "From: Newsletter <letters@outside.test>",
    "To: private@mail.test",
    "Subject: Studio newsletter",
    "Message-ID: <html@outside.test>",
    "Content-Type: text/html; charset=utf-8",
    "",
    '<html><body><p>Studio <b>opening hours</b></p><img src="https://images.example.test/logo.png"></body></html>',
  ].join("\r\n");
  const res = await fetch(
    origin + "/cdn-cgi/local/email?from=letters%40outside.test&to=private%40mail.test",
    { method: "POST", body: source },
  );
  assert.ok(res.ok);
  for (let tries = 0; tries < 80; tries++) {
    const message = (await json(list)).messages.find((m) => m.subject === "Studio newsletter");
    if (message) {
      const detail = await json(list + "/" + message.id);
      assert.equal(detail.body.trim(), "Studio opening hours");
      assert.deepEqual(JSON.parse(detail.deliveries[0].auth), {});
      return;
    }
    await sleep(200);
  }
  assert.fail("HTML-only message missing");
}
