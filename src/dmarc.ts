import { gunzipSync } from "node:zlib";
import { SaxesParser } from "saxes";
import { Unzip, UnzipInflate } from "fflate";
const maximum = 2 * 1024 * 1024;
const invalid = () => {
  throw Error("Invalid aggregate report");
};
function zipXml(bytes: Uint8Array) {
  const fragments: Uint8Array[] = [];
  let size = 0,
    files = 0,
    finished = false;
  const stream = new Unzip((file) => {
    if (++files > 1 || !/^[^/\\]+\.xml$/i.test(file.name)) invalid();
    file.ondata = (error, data, final) => {
      size += data.length;
      if (error || size > maximum) invalid();
      fragments.push(data);
      finished = final;
    };
    file.start();
  });
  stream.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += 512)
    stream.push(bytes.subarray(i, i + 512), i + 512 >= bytes.length);
  if (!finished || files !== 1) invalid();
  return Buffer.concat(fragments, size);
}
const required = (map: Map<string, string>, k: string) => map.get(k) || invalid();
function integer(map: Map<string, string>, k: string) {
  const s = required(map, k);
  if (!/^\d{1,12}$/.test(s)) invalid();
  return Number(s);
}
function readXml(xml: string) {
  const parser = new SaxesParser({ xmlns: true }),
    stack: string[] = [],
    meta = new Map<string, string>();
  const counts = { total: 0, aligned: 0, rejected: 0, quarantined: 0 };
  let row = new Map<string, string>(),
    value = "",
    records = 0,
    namespace = "";
  const selected = new Map(
    Object.entries({
      "feedback/report_metadata/org_name": "issuer",
      "feedback/report_metadata/report_id": "reference",
      "feedback/policy_published/domain": "domain",
      "feedback/report_metadata/date_range/begin": "begin",
      "feedback/report_metadata/date_range/end": "end",
      "feedback/record/row/count": "count",
      "feedback/record/row/policy_evaluated/dkim": "dkim",
      "feedback/record/row/policy_evaluated/spf": "spf",
      "feedback/record/row/policy_evaluated/disposition": "disposition",
    }),
  );
  parser.on("doctype", invalid);
  parser.on("opentag", (tag) => {
    if (!stack.length) {
      namespace = tag.uri;
      if (tag.local !== "feedback" || !["", "urn:ietf:params:xml:ns:dmarc-2.0"].includes(namespace))
        invalid();
    }
    if (stack.length >= 24 || selected.has(stack.join("/"))) invalid();
    stack.push(tag.uri === namespace ? tag.local : "?");
    value = "";
    if (stack.join("/") === "feedback/record") {
      if (++records > 10000) invalid();
      row = new Map();
    }
  });
  const append = (s: string) => {
    if (selected.has(stack.join("/"))) {
      value += s;
      if (value.length > 300) invalid();
    }
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    const path = stack.join("/"),
      field = selected.get(path);
    if (field) {
      const m = path.startsWith("feedback/record/") ? row : meta;
      if (m.has(field)) invalid();
      m.set(field, value.trim());
    }
    if (path === "feedback/record") {
      const count = integer(row, "count"),
        dkim = required(row, "dkim"),
        spf = required(row, "spf"),
        action = required(row, "disposition");
      if (
        !count ||
        !["pass", "fail"].includes(dkim) ||
        !["pass", "fail"].includes(spf) ||
        !["reject", "quarantine", "none", "pass"].includes(action)
      )
        invalid();
      counts.total += count;
      if (dkim === "pass" || spf === "pass") counts.aligned += count;
      if (action === "quarantine") counts.quarantined += count;
      if (action === "reject") counts.rejected += count;
    }
    stack.pop();
    value = "";
  });
  parser.write(xml).close();
  const begin = integer(meta, "begin"),
    end = integer(meta, "end");
  if (!records || !Number.isSafeInteger(counts.total) || end < begin || end > 253402300799)
    invalid();
  return {
    issuer: required(meta, "issuer"),
    reference: required(meta, "reference"),
    domain: required(meta, "domain").toLowerCase(),
    begin,
    end,
    ...counts,
  };
}
export function parseAggregate(name: string, bytes: Uint8Array) {
  if (bytes.byteLength > maximum) return null;
  try {
    const xml = /\.gz$/i.test(name)
      ? gunzipSync(bytes, { maxOutputLength: maximum })
      : /\.zip$/i.test(name)
        ? zipXml(bytes)
        : bytes;
    return readXml(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(xml));
  } catch {
    return null;
  }
}
