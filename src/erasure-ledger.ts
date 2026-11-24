import { Problem } from "./env";
type Store = { DB: D1Database; MAIL: R2Bucket };
export type Erasure = {
  version: 1;
  box: string;
  id: string;
  hash: string;
  at: number;
  raw: string[];
};
export const markerPrefix = "deletions/messages/";
export const markerKey = (box: string, hash: string) => markerPrefix + box + "/" + hash + ".json";
const code = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export function validateMarker(m: Erasure, key: string) {
  if (
    m.version !== 1 ||
    !code.test(m.box) ||
    !code.test(m.id) ||
    !/^(?:[a-f0-9]{64}|sent-[0-9A-HJKMNP-TV-Z]{26})$/.test(m.hash) ||
    !Number.isSafeInteger(m.at) ||
    !(
      key === markerKey(m.box, m.hash) ||
      (key.startsWith("deletions/late/" + m.box + "/") &&
        m.raw?.length === 1 &&
        key.split("/").at(-1) === m.raw[0].split("/").at(-1)?.replace(".eml", ".json"))
    ) ||
    !Array.isArray(m.raw)
  )
    throw Error("Unknown deletion receipt");
  if (
    m.raw.some(
      (k) =>
        !k.startsWith("raw/" + m.box + "/") ||
        !/^raw\/[0-9A-HJKMNP-TV-Z]{26}\/\d{4}\/\d{2}\/[0-9A-HJKMNP-TV-Z]{26}\.eml$/.test(k),
    )
  )
    throw Error("Invalid receipt object");
  return m;
}
export async function indexMarker(db: D1Database, m: Erasure) {
  const sent = "sent/" + m.box + "/" + m.id,
    exact = [...m.raw, "html/" + m.box + "/" + m.id];
  if (m.hash.startsWith("sent-")) exact.push(sent + ".eml", sent + ".envelope.json", sent + ".txt");
  else exact.push("body/" + m.box + "/" + m.hash + ".txt");
  const prefixes = ["att/" + m.box + "/" + m.id + "/", "att/uploads/" + m.box + "/" + m.id + "/"];
  await db.batch([
    db
      .prepare("INSERT INTO erasures(box,id,hash,at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING")
      .bind(m.box, m.id, m.hash, m.at),
    db
      .prepare(
        "INSERT OR IGNORE INTO erased_objects(key,box,id,prefix) SELECT value,?,?,0 FROM json_each(?)",
      )
      .bind(m.box, m.id, JSON.stringify(exact)),
    db
      .prepare(
        "INSERT OR IGNORE INTO erased_objects(key,box,id,prefix) SELECT value,?,?,1 FROM json_each(?)",
      )
      .bind(m.box, m.id, JSON.stringify(prefixes)),
  ]);
}
export async function blockedObject(db: D1Database, key: string) {
  const parts = key.split("/");
  const prefix = parts.slice(0, parts[1] === "uploads" ? 4 : 3).join("/") + "/";
  return !!(await db
    .prepare("SELECT 1 FROM erased_objects WHERE key IN (?,?) LIMIT 1")
    .bind(key, prefix)
    .first());
}
export async function hideErased(env: Store, box: string, id: string) {
  const db = env.DB;
  const m = await db
    .prepare("SELECT body_key FROM messages WHERE mailbox_id=? AND id=?")
    .bind(box, id)
    .first<{ body_key: string }>();
  const end = db.prepare("UPDATE erasures SET hidden=1 WHERE box=? AND id=?").bind(box, id);
  if (!m) {
    await end.run();
    return;
  }
  let text = "";
  if (m.body_key !== "erased") {
    const raw = await env.MAIL.get(m.body_key, { range: { offset: 0, length: 16384 } });
    if (!raw) throw new Problem(503, "Original text is needed to remove the search entry");
    text = await raw.text();
  }
  const stmt = (query: string, ...params: (string | number)[]) => db.prepare(query).bind(...params);
  const jobs =
    "(SELECT id FROM vacation_replies WHERE mailbox_id=? AND message_id=? UNION SELECT outbox_id FROM forward_attempts WHERE mailbox_id=? AND source_message=?)";
  await db.batch([
    ...(m.body_key === "erased"
      ? []
      : [
          stmt(
            "INSERT INTO search_fts(search_fts,rowid,subject,body_text) SELECT 'delete',rowid,subject,? FROM messages WHERE mailbox_id=? AND id=?",
            text,
            box,
            id,
          ),
        ]),
    stmt(
      "UPDATE outbox SET state='cancelled',error_code='message_erased',reserved_day=NULL WHERE state IN ('held','deferred') AND (parent=? OR id IN " +
        jobs +
        ")",
      id,
      box,
      id,
      box,
      id,
    ),
    stmt("UPDATE outbox SET parent=NULL WHERE mailbox_id=? AND parent=?", box, id),
    stmt("UPDATE drafts SET parent=NULL WHERE mailbox_id=? AND parent=?", box, id),
    stmt(
      "DELETE FROM delivery_events WHERE EXISTS(SELECT 1 FROM outbox o WHERE o.mailbox_id=? AND o.id=? AND o.provider=delivery_events.provider AND trim(o.provider_id,'<>')=delivery_events.provider_id AND substr(o.from_addr,instr(o.from_addr,'@')+1)=delivery_events.domain)",
      box,
      id,
    ),
    stmt("DELETE FROM outbox WHERE mailbox_id=? AND id=?", box, id),
    stmt(
      "INSERT OR IGNORE INTO erased_objects(key,box,id,prefix) SELECT raw_key,mailbox_id,message_id,0 FROM deliveries WHERE mailbox_id=? AND message_id=?",
      box,
      id,
    ),
    stmt("DELETE FROM vacation_replies WHERE mailbox_id=? AND message_id=?", box, id),
    stmt("DELETE FROM forward_attempts WHERE mailbox_id=? AND source_message=?", box, id),
    stmt("DELETE FROM push_jobs WHERE mailbox_id=? AND event=?", box, id),
    stmt("DELETE FROM triage_undo WHERE message_id=?", id),
    stmt("DELETE FROM thread_members WHERE mailbox_id=? AND message_id=?", box, id),
    stmt(
      "UPDATE thread_state SET thread_id=(SELECT min(message_id) FROM thread_members WHERE mailbox_id=?1 AND thread_id=?2),revision=lower(hex(randomblob(16))) WHERE mailbox_id=?1 AND thread_id=?2 AND EXISTS(SELECT 1 FROM thread_members WHERE mailbox_id=?1 AND thread_id=?2)",
      box,
      id,
    ),
    stmt(
      "UPDATE thread_members SET thread_id=(SELECT min(message_id) FROM thread_members WHERE mailbox_id=? AND thread_id=?) WHERE mailbox_id=? AND thread_id=?",
      box,
      id,
      box,
      id,
    ),
    ...["rule_runs", "message_labels", "deliveries"].map((t) =>
      stmt("DELETE FROM " + t + " WHERE mailbox_id=? AND message_id=?", box, id),
    ),
    ...["reply_headers", "message_metadata"].map((t) =>
      stmt("DELETE FROM " + t + " WHERE message_id=?", id),
    ),
    stmt("DELETE FROM messages WHERE mailbox_id=? AND id=?", box, id),
    end,
  ]);
}
async function deleteObject(bucket: R2Bucket, key: string, now: number) {
  const obj = await bucket.head(key);
  if (obj) {
    try {
      await bucket.delete(key);
    } catch (error) {
      const lockedUntil = obj.uploaded.getTime() + 35 * 86400000;
      if (!/^(raw|sent)\//.test(key) || lockedUntil <= now) throw error;
      return error instanceof Error && /retention|lock|protected/i.test(error.message)
        ? lockedUntil
        : now + 3600000;
    }
  }
  return 0;
}
export async function cleanupObjects(env: Store, box?: string, id?: string) {
  const now = Date.now();
  const rows = await env.DB.prepare(
    "SELECT k.key,k.prefix FROM erased_objects k JOIN erasures e ON e.box=k.box AND e.id=k.id WHERE e.hidden=1 AND k.done=0 AND k.due<=? AND (? IS NULL OR k.box=?) AND (? IS NULL OR k.id=?) ORDER BY k.due LIMIT 24",
  )
    .bind(now, box ?? null, box ?? null, id ?? null, id ?? null)
    .all<{ key: string; prefix: number }>();
  for (const row of rows.results) {
    let due = 0;
    if (row.prefix) {
      const list = await env.MAIL.list({ prefix: row.key, limit: 64 });
      if (list.objects.length) await env.MAIL.delete(list.objects.map((o) => o.key));
      if (list.truncated) continue;
    } else {
      due = await deleteObject(env.MAIL, row.key, now);
    }
    await env.DB.prepare("UPDATE erased_objects SET done=?,due=? WHERE key=?")
      .bind(Number(due <= now), due, row.key)
      .run();
  }
}
