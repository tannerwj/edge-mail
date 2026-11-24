import { mailProtection } from "../mail-protection";
import { erasedMailboxReceipt } from "../person-storage";
import { reportStatements } from "./reports";
import { indexText } from "../index-text";
import { markerKey, validateMarker, indexMarker, type Erasure } from "../erasure-ledger";
import { wakePush, notifyArrival } from "./push";
import { mailFacts, arrivalActions } from "./rule-engine";
import { changed } from "../live";
import { createHash } from "node:crypto";
import { convert } from "html-to-text";
import PostalMime, { type Address } from "postal-mime";
import { ulid } from "ulid";
import { Problem, type Bindings, type Principal } from "../env";
import { replyReferences } from "../threading";
import { separator } from "../wire";
import { indexConversation } from "./conversations";
import { ingestAccess } from "./access";
import { MAX_RAW, type Receipt } from "./receipt";

type Store = Pick<Bindings, "MAIL" | "DB">;
type IngestEnvironment = Bindings | (Store & { recovery: true });
const keyPattern = /^raw\/([0-9A-HJKMNP-TV-Z]{26})\/\d{4}\/\d{2}\/([0-9A-HJKMNP-TV-Z]{26})\.eml$/;
export function receiptJob(key: string) {
  const match = keyPattern.exec(key);
  if (!match) throw new Problem(400, "Invalid receipt key");
  return { kind: "ingest", mailbox: match[1] } as const;
}
// Legacy receipts are replayed once when a new searchable metadata row is required.
const indexedReceipt =
  "SELECT 1 FROM deliveries d JOIN message_metadata md ON md.message_id=d.message_id JOIN thread_members t ON t.mailbox_id=d.mailbox_id AND t.message_id=d.message_id JOIN reply_headers rh ON rh.message_id=d.message_id WHERE d.raw_key=?1 UNION ALL SELECT 1 FROM erased_objects WHERE key=?1 LIMIT 1";
function addresses(values: Address[] = []) {
  return values
    .flatMap((v) => (v.group ? v.group.map((m) => m.address) : [v.address]))
    .join("\n")
    .slice(0, 65536);
}
async function erasedReceipt(env: Store, key: string, meta: Receipt, hash: string) {
  const erased = await env.MAIL.get(markerKey(meta.mailbox, hash));
  if (!erased) return false;
  const m = validateMarker(await erased.json<Erasure>(), erased.key);
  if (!m.raw.includes(key)) {
    const late = { ...m, raw: [key] };
    await env.MAIL.put("deletions/late/" + m.box + "/" + meta.id + ".json", JSON.stringify(late), {
      onlyIf: { etagDoesNotMatch: "*" },
    });
    await indexMarker(env.DB, late);
  } else await indexMarker(env.DB, m);
  // A concurrent import or ingest may have written these objects after a cleanup checkpoint.
  await env.DB.prepare("UPDATE erased_objects SET done=0,due=0 WHERE key IN (?,?) AND done=1")
    .bind(key, "body/" + meta.mailbox + "/" + hash + ".txt")
    .run();
  return true;
}
async function materialize(env: Store, raw: R2ObjectBody, meta: Receipt) {
  if (raw.size > MAX_RAW) throw new Error("Receipt exceeds parse limit");
  if (await erasedMailboxReceipt(env, meta.mailbox)) return null;
  const bytes = new Uint8Array(await raw.arrayBuffer());
  const parsed = await PostalMime.parse(bytes);
  const stable = parsed.headers
    .filter((h) =>
      /^(from|to|cc|bcc|sender|reply-to|date|subject|message-id|in-reply-to|references|mime-version|content-.+|list-id|auto-submitted)$/.test(
        h.key,
      ),
    )
    .map((h) => [h.key, h.value]);
  const boundary = separator(bytes);
  const hash = createHash("sha256")
    .update(JSON.stringify(stable))
    .update("\0")
    .update(bytes.subarray(boundary < 0 ? 0 : boundary))
    .digest("hex");
  if (await erasedReceipt(env, raw.key, meta, hash)) return null;
  const bodyKey = `body/${meta.mailbox}/${hash}.txt`;
  const body =
    parsed.text ||
    (parsed.html
      ? convert(parsed.html, {
          wordwrap: false,
          selectors: [{ selector: "img", format: "skip" }],
          limits: { maxInputLength: MAX_RAW },
        })
      : "");
  await env.MAIL.put(bodyKey, body, {
    customMetadata: {
      protection: mailProtection(
        parsed.headers.find((h) => h.key === "content-type")?.value || "",
        body.slice(0, 128),
      ),
      formatted: parsed.html ? "yes" : "no",
      list: parsed.headers.some((h) => h.key === "list-unsubscribe-post") ? "yes" : "no",
    },
  });
  return {
    hash,
    bodyKey,
    body,
    reports: await reportStatements(
      env,
      meta,
      parsed.attachments,
      hash,
      parsed.from?.address || "",
    ),
    facts: mailFacts(parsed, meta, body, raw.size),
    sender: parsed.from?.address || meta.from,
    subject: (parsed.subject || "").slice(0, 4096),
    wireId: parsed.messageId?.slice(0, 998),
    replyTo: addresses(parsed.replyTo),
    parent: parsed.inReplyTo || "",
    references: parsed.references || "",
    automated: parsed.headers.some(
      (h) =>
        h.key === "list-id" ||
        (h.key === "auto-submitted" && h.value.toLowerCase() !== "no") ||
        (h.key === "precedence" && /^(bulk|list|junk)$/i.test(h.value)),
    ),
    attachments: parsed.attachments.length,
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
  };
}
async function loadReceipt(env: Store, p: Principal, key: string) {
  const job = receiptJob(key);
  ingestAccess(p, job.mailbox);
  if (await env.DB.prepare(indexedReceipt).bind(key).first()) return null;
  const raw = await env.MAIL.get(key);
  if (!raw?.customMetadata?.receipt) throw Error("Receipt metadata missing");
  const meta: Receipt = JSON.parse(raw.customMetadata.receipt);
  if (meta.mailbox !== job.mailbox || !key.endsWith("/" + meta.id + ".eml"))
    throw Error("Receipt identity mismatch");
  return { job, raw, meta };
}
export async function ingest(env: IngestEnvironment, p: Principal, key: string) {
  const live = "recovery" in env ? undefined : env;
  const receipt = await loadReceipt(env, p, key);
  if (!receipt) return;
  const { job, raw, meta } = receipt;
  const mail = await materialize(env, raw, meta);
  if (!mail) return;
  const id = ulid();
  const owner = [job.mailbox, mail.hash];
  const arrival = meta.kind === "import" ? undefined : live;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO messages(id,mailbox_id,content_hash,wire_id,synthetic,sender,subject,snippet,body_key,received_at,attachment_count)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM erasures WHERE box=? AND hash=?) ON CONFLICT(mailbox_id,content_hash) DO NOTHING`).bind(
      id,
      ...owner,
      mail.wireId || `<${mail.hash}@edge-mail.invalid>`,
      Number(!mail.wireId),
      mail.sender,
      mail.subject,
      mail.body.slice(0, 180),
      mail.bodyKey,
      meta.at,
      mail.attachments,
      ...owner,
    ),
    env.DB.prepare(`INSERT INTO deliveries SELECT ?,mailbox_id,id,?,?,?,?,?,?,?,? FROM messages WHERE mailbox_id=? AND content_hash=?
      ON CONFLICT(id) DO NOTHING`).bind(
      meta.id,
      key,
      meta.from,
      meta.to,
      meta.matched,
      meta.kind,
      meta.tag,
      meta.at,
      JSON.stringify(meta.auth),
      ...owner,
    ),
    ...(meta.kind === "plus" && meta.tag && meta.tag.length <= 80
      ? [
          env.DB.prepare(
            "INSERT OR IGNORE INTO message_labels SELECT mailbox_id,message_id,plus_tag FROM deliveries WHERE id=? AND changes()=1 AND coalesce((SELECT label_plus FROM receipt_preferences WHERE mailbox_id=deliveries.mailbox_id),1)=1",
          ).bind(meta.id),
        ]
      : []),
    env.DB.prepare(
      "INSERT INTO message_metadata SELECT id,?,?,? FROM messages WHERE mailbox_id=? AND content_hash=? ON CONFLICT DO NOTHING",
    ).bind(raw.size, mail.to, mail.cc, ...owner),
    env.DB.prepare(
      "INSERT INTO reply_headers SELECT id,?,? FROM messages WHERE mailbox_id=? AND content_hash=? ON CONFLICT DO NOTHING",
    ).bind(mail.replyTo, replyReferences(mail.references, mail.parent), ...owner),
    indexConversation(env, meta, mail),
    // Only the winning INSERT owns this id. Replays and concurrent aliases never reinsert its FTS row.
    env.DB.prepare(
      "INSERT INTO search_fts(rowid,subject,body_text) SELECT rowid,subject,? FROM messages WHERE id=?",
    ).bind(indexText(mail.body), id),
    ...mail.reports,
    ...(arrival ? await arrivalActions(arrival, meta, id, mail.facts, mail.body) : []),
    ...(arrival ? [notifyArrival(arrival, job.mailbox, id)] : []),
    env.DB.prepare("DELETE FROM ingest_failures WHERE raw_key=?").bind(key),
  ]);
  if (
    await env.DB.prepare("SELECT 1 FROM erasures WHERE box=? AND hash=?")
      .bind(...owner)
      .first()
  ) {
    await erasedReceipt(env, key, meta, mail.hash);
    return;
  }
  if (live) {
    await changed(live, job.mailbox);
    if (arrival) await wakePush(arrival, id);
  }
}
export async function consume(batch: MessageBatch, env: Bindings) {
  for (const item of batch.messages) {
    if (typeof item.body !== "string") {
      item.retry();
      continue;
    }
    try {
      await ingest(env, receiptJob(item.body), item.body);
      item.ack();
    } catch {
      item.retry();
      await env.DB.prepare(`INSERT INTO ingest_failures VALUES (?,1,CURRENT_TIMESTAMP) ON CONFLICT(raw_key)
        DO UPDATE SET attempts=attempts+1,last_at=CURRENT_TIMESTAMP`)
        .bind(item.body)
        .run();
    }
  }
}
export async function reconcile(env: Bindings) {
  const cursor = await env.DB.prepare("SELECT cursor FROM reconciliation WHERE id=1").first<string>(
    "cursor",
  );
  const page = await env.MAIL.list({ prefix: "raw/", cursor: cursor || undefined, limit: 40 });
  for (const obj of page.objects) {
    if (!keyPattern.test(obj.key)) continue;
    if (!(await env.DB.prepare(indexedReceipt).bind(obj.key).first()))
      await env.INGEST.send(obj.key);
  }
  await env.DB.prepare("UPDATE reconciliation SET cursor=? WHERE id=1 AND cursor IS ?")
    .bind(page.truncated ? page.cursor : null, cursor)
    .run();
}
