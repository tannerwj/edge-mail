// A browser fixture cannot cover the rule grammar's depth, repetition and text boundaries.
import assert from "node:assert/strict";
import { test } from "@hegeldev/hegel";
import { text } from "@hegeldev/hegel/generators";
import { compileCondition } from "../src/rule-matcher.ts";
const subject = (op, value) => ({ field: "subject", op, value });
const matches = (op, value, input) => compileCondition(subject(op, value))({ subject: [input] });
for (const invalid of ["(abc)+", "z".repeat(129), "[", "ab**", "a\\1", "x{999999}"])
  assert.throws(() => compileCondition(subject("matches", invalid)));
assert.ok(matches("matches", "^invoice [0-9]+$", "Invoice 810"));
assert.equal(matches("matches", "^invoice [0-9]+$", "Past invoice 810"), false);
assert.ok(matches("glob", "a?c*", "Abcde"));
assert.equal(matches("glob", "a?c*", "abbc"), false);
assert.ok(
  compileCondition({ all: [subject("contains", "receipt"), { not: subject("equals", "refund") }] })(
    { subject: ["Receipt #1"] },
  ),
);
assert.equal(
  compileCondition({ any: [subject("equals", "refund"), subject("in", ["order", "invoice"])] })({
    subject: ["Invoice"],
  }),
  true,
);
for (const invalid of [
  { any: [] },
  { not: { not: { not: { not: { not: { not: subject("equals", "x") } } } } } },
  subject("in", []),
  { all: Array(30).fill(subject("equals", "x")) },
])
  assert.throws(() => compileCondition(invalid));
test((tc) => {
  const literal = tc.draw(text({ alphabet: "abcXYZ012", minSize: 1, maxSize: 45 }));
  assert.equal(matches("matches", "^" + literal + "$", literal.toLowerCase()), true);
  assert.equal(matches("matches", "^" + literal + "$", literal + "!"), false);
});
test((tc) => {
  const inside = tc.draw(text({ alphabet: "abc?+|.^$123", minSize: 1, maxSize: 40 }));
  assert.throws(() => compileCondition(subject("matches", "(" + inside + ")*")));
});
console.log("PASS · bounded rule grammar, literal equivalence, forbidden repetitions and nesting");
