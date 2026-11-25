import { canReopen } from "./outbox";
import { Problem, type Bindings } from "../env";
import { writableMailboxes, type User } from "./access";

export async function combinedWork(
  env: Bindings,
  user: User,
  drafts: boolean,
  cursor: string | null,
) {
  const order = drafts ? "updated_at" : "due_ms";
  const fields = drafts
    ? "updated_at AS stamp,json_extract(content,'$.subject') AS subject,json_extract(content,'$.to') AS recipient"
    : "due_ms AS stamp,json_extract(letter,'$.subject') AS subject," + canReopen + " AS reopen";
  const source = drafts ? "drafts" : "outbox";
  const filter = drafts
    ? "discarded_until IS NULL"
    : "json_extract(letter,'$.scheduledFor') IS NOT NULL AND state IN ('held','deferred')";
  const dir = drafts ? "DESC" : "ASC";
  const [stamp, id] = (cursor || "").split("~");
  if (cursor && (!stamp || !id || (!drafts && !Number.isSafeInteger(Number(stamp)))))
    throw new Problem(400, "Invalid folder cursor");
  const sql = `SELECT id,mailbox_id,${fields} FROM ${source} WHERE actor=? AND mailbox_id IN (${writableMailboxes}) AND ${filter}
    ${cursor ? "AND (" + order + ",id)" + (drafts ? "<" : ">") + "(?,?)" : ""} ORDER BY ${order} ${dir},id ${dir} LIMIT 51`;
  const rows = await env.DB.prepare(sql)
    .bind(user.id, user.id, ...(cursor ? [drafts ? stamp : Number(stamp), id] : []))
    .all<{ id: string; stamp: string | number }>();
  const items = rows.results.slice(0, 50),
    last = items.at(-1);
  return { items, next: rows.results.length > 50 && last ? last.stamp + "~" + last.id : null };
}
