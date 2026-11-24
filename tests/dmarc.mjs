import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { gzipSync } from "node:zlib";
import { parseAggregate } from "../src/dmarc.ts";
// A normal receipt journey cannot cover ambiguous duplicate counts, unknown XML vocabulary
// and an oversized compressed report without obscuring the pipeline assertions.
import { sample } from "./dmarc-sample.mjs";
const parse = (s) => parseAggregate("report.xml", Buffer.from(s));
assert.deepEqual(parse(sample), {
  issuer: "Fictional Receiver",
  reference: "report-26",
  domain: "mail.test",
  begin: 1760000000,
  end: 1760086400,
  total: 15,
  aligned: 12,
  rejected: 3,
  quarantined: 0,
});
assert.deepEqual(parseAggregate("report.xml.gz", gzipSync(sample)), parse(sample));
assert.deepEqual(
  parseAggregate("report.zip", zipSync({ "report.xml": Buffer.from(sample) })),
  parse(sample),
);
for (const xml of [
  "<!DOCTYPE feedback SYSTEM 'about:blank'>" + sample,
  sample.replace("<count>12</count>", "<count>1</count><count>11</count>"),
  sample.replace("1760086400", "1750000000"),
  sample.replace("dmarc-2.0", "arbitrary"),
  sample.replace("<count>3", "<count>-3"),
])
  assert.equal(parse(xml), null);
assert.equal(parseAggregate("large.xml.gz", gzipSync("x".repeat(2 * 1024 * 1024 + 1))), null);
console.log("PASS · DMARC record counts, alignment, compression bounds and ambiguous XML");
