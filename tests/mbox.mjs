import assert from "node:assert/strict";
import { archiveEntries, quoteFrom } from "../web/mbox.ts";
const sep = "From author@example.test Fri Nov 20 11:22:33 2026\n";
const wire = "From: author@example.test\nSubject: Visits\n\nFrom here\n>From a letter\n";
const fixture =
  sep +
  wire.replace("\nFrom here", "\n>From here").replace("\n>From a letter", "\n>>From a letter") +
  "\n" +
  sep +
  "Subject: Next\n\nBye\n\n";
const collect = async (blob) => Array.fromAsync(archiveEntries(blob));
for (const width of [1, 3, 511, 65536]) {
  const rows = await Array.fromAsync(archiveEntries(new Blob([fixture]), width));
  assert.equal(rows.length, 2);
  assert.equal(await rows[0].body.text(), wire);
  assert.equal(await rows[1].body.text(), "Subject: Next\n\nBye\n");
  assert.equal(rows[0].from, "author@example.test");
}
assert.equal(
  await quoteFrom(new Blob([wire]), true).then((b) => b.text()),
  "From: author@example.test\nSubject: Visits\n\n>From here\n>>From a letter\n",
);
await assert.rejects(collect(new Blob(["Subject: Not a mailbox\n\nBody"])), /delimiter/);
console.log(
  "PASS · mboxrd escapes, message boundaries across chunks, original bytes and invalid archive",
);
