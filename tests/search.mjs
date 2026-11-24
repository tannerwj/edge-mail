// Token boundaries and date/size conversions need deterministic coverage beyond the inbox journey.
import { test } from "@hegeldev/hegel";
import { text } from "@hegeldev/hegel/generators";
import assert from "node:assert/strict";
import { parseSearch } from "../src/search.ts";
const now = Date.UTC(2026, 10, 23, 12);
const terms = (q) => parseSearch(q, now);
assert.deepEqual(terms('from:Jane subject:"two words" -"quoted phrase"'), [
  { key: "from", value: "Jane", negative: false },
  { key: "subject", value: "two words", negative: false },
  { key: "text", value: "quoted phrase", negative: true },
]);
assert.deepEqual(
  terms("after:2024-02-29 older_than:2d larger:2M").map((t) => t.value),
  ["2024-02-29T00:00:00.000Z", "2026-11-21T12:00:00.000Z", 2097152],
);
for (const bad of [
  '"unterminated',
  "before:2025-02-29",
  "older_than:cat",
  "larger:-3",
  "in:vacuum",
  "is:admin",
  "from:",
  '"a"b',
  "a ".repeat(25),
])
  assert.throws(() => terms(bad));
test((tc) => {
  const word = tc.draw(text({ alphabet: "abcXYZ012", minSize: 1, maxSize: 32 }));
  assert.deepEqual(terms('subject:"' + word + ' pattern" -from:' + word), [
    { key: "subject", value: word + " pattern", negative: false },
    { key: "from", value: word, negative: true },
  ]);
});
console.log("PASS · search syntax, UTC cutoffs and size units");
