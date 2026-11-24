import assert from "node:assert/strict";
import { oneClick } from "../src/list-unsubscribe.ts";
const sig = "b".repeat(86) + "==",
  url = "https://subscriptions.publisher.test/leave/opaque";
const fields = [
  "Authentication-Results: mx.cloudflare.net; dkim=pass header.d=publisher.test header.s=news header.b=" +
    sig.slice(0, 16),
  "DKIM-Signature: v=1; a=rsa-sha256; d=publisher.test; s=news; h=from:list-unsubscribe:list-unsubscribe-post; b=" +
    sig,
  "From: Newsletter <news@publisher.test>",
  "List-Unsubscribe: <mailto:leave@publisher.test>, <" + url + ">",
  "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
];
const parse = (lines) => oneClick(lines.join("\r\n"));
for (const [i, bad] of [
  [0, fields[0].replace("pass", "neutral")],
  [0, fields[0].replace(sig.slice(0, 16), "1234567890")],
  [1, fields[1].replace(":list-unsubscribe-post;", ";")],
  [1, fields[1].replace("from:list-unsubscribe:", "from:")],
  [2, "From: foreign@other.test"],
  [3, "List-Unsubscribe: <http://subscriptions.publisher.test/leave>"],
])
  assert.equal(parse(fields.with(i, bad)), null);
for (const i of [1, 2, 3, 4]) assert.equal(parse([...fields, fields[i]]), null);
assert.equal(parse(["Authentication-Results: untrusted.example; dkim=pass", ...fields]), null);
assert.equal(parse(fields)?.href, url);
console.log(
  "PASS · one-click URL needs an unambiguous Cloudflare DKIM result linked to a signature covering both unique list headers and the author",
);
