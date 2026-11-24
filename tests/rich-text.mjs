import assert from "node:assert/strict";
import { formatText } from "../src/rich-text.ts";
const { html, text } = formatText("A **bold** _word_ & <tag>\nnext", true, []);
assert.equal(text, "A bold word & <tag>\nnext");
assert.equal(html, "<p>A <strong>bold</strong> <em>word</em> &amp; &lt;tag&gt;<br>next</p>");
assert.equal(formatText("_literal_", false, []).html, undefined);
console.log("PASS · formatted alternatives preserve literal text and escape HTML in messages");
