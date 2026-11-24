import { reserveReceipt } from "../inbound-capacity";
import { createHash } from "node:crypto";
import { type Bindings, Problem } from "../env";
import { type User } from "./access";
import { owning, owner } from "./destinations";
import { MAX_RAW, type Receipt } from "./receipt";
import { permitted } from "../content-ticket";
import { ingest, receiptJob } from "./ingest";

async function messageBytes(req: Request) {
  if (req.headers.get("content-type") !== "message/rfc822")
    throw new Problem(415, "Upload the original Internet message");
  const length = req.headers.get("content-length");
  if (!length || !/^\d+$/.test(length))
    throw new Problem(411, "Supply the original message length");
  if (Number(length) > MAX_RAW) throw new Problem(413, "Imported message exceeds 25 MiB");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length || bytes.length !== Number(length))
    throw new Problem(400, "Incomplete message");
  return bytes;
}
async function storeImport(
  env: Bindings,
  receipt: Receipt,
  key: string,
  bytes: Uint8Array<ArrayBuffer>,
) {
  if (
    !(await reserveReceipt(env, receipt.mailbox, {
      id: receipt.id,
      key,
      size: bytes.byteLength,
      from: "",
      to: "",
      historical: true,
    }))
  )
    throw new Problem(409, "Mailbox storage limit reached");
  await env.MAIL.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "message/rfc822" },
    customMetadata: { receipt: JSON.stringify(receipt) },
  });
}
async function importMessage(env: Bindings, user: User, box: string, req: Request) {
  const address = await env.DB.prepare("SELECT address FROM mailboxes WHERE id IN (" + owning + ")")
    .bind(user.id, box)
    .first<string>("address");
  if (!address) throw new Problem(403, "Mailbox owner required");
  const bytes = await messageBytes(req);
  const headers = new TextDecoder().decode(bytes.subarray(0, 65536)).split(/\r?\n\r?\n/, 1)[0];
  if (!/^[\w-]+:[^\r\n]*/m.test(headers)) throw new Problem(400, "Message headers are missing");
  const date = Date.parse(/^Date:[ \t]*(.+)$/im.exec(headers)?.[1] || "");
  const fallback = Date.parse(req.headers.get("x-archive-date") || "");
  const at = new Date(
    Number.isFinite(date) ? date : Number.isFinite(fallback) ? fallback : 0,
  ).toISOString();
  const id = createHash("sha256")
    .update(box)
    .update(bytes)
    .digest("hex")
    .slice(0, 26)
    .toUpperCase();
  const keyDate = Number.isFinite(date) ? at : "1970-01";
  const key =
    "raw/" + box + "/" + keyDate.slice(0, 4) + "/" + keyDate.slice(5, 7) + "/" + id + ".eml";
  const erased = () =>
    env.DB.prepare("SELECT id FROM erased_objects WHERE key=?").bind(key).first();
  if (await erased()) return Response.json({ id, erased: true });
  const from = req.headers.get("x-archive-from") || "";
  const receipt: Receipt = {
    id,
    mailbox: box,
    from: from.slice(0, 254),
    to: address,
    matched: address,
    kind: "import",
    tag: null,
    at,
    auth: {},
  };
  await storeImport(env, receipt, key, bytes);
  await ingest(env, receiptJob(key), key);
  if (await erased()) {
    await env.DB.prepare("UPDATE erased_objects SET done=0,due=0 WHERE key=? AND done=1")
      .bind(key)
      .run();
    return Response.json({ id, erased: true });
  }
  return Response.json({ id });
}
async function exportPage(env: Bindings, user: User, box: string, url: URL) {
  const after = url.searchParams.get("after") || "";
  const rows = await env.DB.prepare(
    "SELECT id,received_at,sender,wire_id,folder,is_read,starred,(SELECT json_group_array(label) FROM message_labels l WHERE l.mailbox_id=m.mailbox_id AND l.message_id=m.id) labels FROM messages m WHERE mailbox_id IN (" +
      owning +
      ") AND id>? ORDER BY id LIMIT 101",
  )
    .bind(user.id, box, after)
    .all<{ id: string }>();
  return Response.json({
    items: rows.results.slice(0, 100),
    next: rows.results.length > 100 ? rows.results[99].id : null,
  });
}
export async function archiveTransfer(
  req: Request,
  env: Bindings,
  user: User,
  box: string,
  part: string | undefined,
  url: URL,
) {
  if (req.method === "POST" && !part) return importMessage(env, user, box, req);
  if (req.method !== "GET") throw new Problem(405, "Unknown archive operation");
  await owner(env, user, box);
  if (!part) return exportPage(env, user, box, url);
  const target = await permitted(env, user.id, box, part);
  const obj = target?.raw_key && (await env.MAIL.get(target.raw_key));
  if (!obj) throw new Problem(404, "Original message unavailable");
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="' + part + '.eml"',
    },
  });
}
