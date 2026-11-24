import { test } from "@hegeldev/hegel";
import { text } from "@hegeldev/hegel/generators";
import assert from "node:assert/strict";
import { replyReferences, subjectKey } from "../src/threading.ts";
assert.equal(subjectKey("  AW: Fwd: re:   Order    status  "), "order status");
assert.equal(subjectKey("Reward: tracking"), "reward: tracking");
assert.equal(replyReferences("<first@x> <old@x> <third@x>", "<last@x>", 23), "<first@x> <last@x>");
assert.equal(replyReferences("<a@x> <b@x>", "<a@x>"), "<a@x> <b@x>");
assert.equal(replyReferences("bad\r\nBcc: injected", "<a@x>"), "<a@x>");
assert.equal(replyReferences("", "<#@x>"), "<#@x>");
test((tc) => {
  const suffix = tc.draw(text({ alphabet: "abcXYZ012", minSize: 1, maxSize: 40 }));
  const parent = "<" + suffix + "@x>";
  const budget = "<root@x> ".length + parent.length;
  assert.equal(replyReferences("<root@x> <earlier@x>", parent, budget), "<root@x> " + parent);
});
console.log("PASS · nested subject prefixes and bounded reply references");
