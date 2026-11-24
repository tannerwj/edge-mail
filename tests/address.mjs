import assert from "node:assert/strict";
import { test } from "@hegeldev/hegel";
import { text } from "@hegeldev/hegel/generators";
import { address, domainName } from "../src/address.ts";

// A normalized mailbox must itself be a valid envelope address, including its octet limit.
assert.throws(() => address("İ".repeat(32) + "@example.test"), /Invalid address/);
assert.equal(domainName("BÜCHER.example"), "xn--bcher-kva.example");
test((tc) => {
  const local = tc.draw(text({ alphabet: "abcXYZ012", minSize: 1, maxSize: 56 }));
  const original = local + "+TAG@EXAMPLE.TEST";
  const { canonical } = address(original);
  assert.equal(canonical, local.toLowerCase() + "+tag@example.test");
  assert.equal(address(original).original, original);
  assert.equal(address(canonical).canonical, canonical);
});
console.log("PASS · canonical address round-trip, IDN domain and UTF-8 local-part limit");
