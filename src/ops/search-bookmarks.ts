import { type Bindings, Problem, requireValue } from "../env";
import { mailboxAccess, type User } from "./access";
import { parseSearch } from "../search";
import { folderList } from "./folder-list";
const permitted = "SELECT b.id " + mailboxAccess + " AND b.id=?";
export async function unifiedInbox(env: Bindings, u: User, url: URL) {
  const domain = url.searchParams.get("domain") || "",
    before = url.searchParams.get("before") || "";
  const [at, id] = before.split("~");
  if (before && (!id || !at)) throw new Problem(400, "Invalid page cursor");
  const rows = await folderList(env, u.id, { domain }, "inbox", at, id).all<{
    id: string;
    received_at: string;
  }>();
  const messages = rows.results.slice(0, 50),
    last = messages.at(-1);
  return {
    messages,
    next: rows.results.length > 50 && last ? last.received_at + "~" + last.id : null,
  };
}
export async function searchBookmarks(
  env: Bindings,
  u: User,
  raw: unknown,
  data?: Record<string, unknown>,
) {
  const box = requireValue(raw, 26);
  if (!(await env.DB.prepare(permitted).bind(u.id, box).first()))
    throw new Problem(404, "Mailbox unavailable");
  if (data) {
    const q = requireValue(data.query, 1024);
    parseSearch(q);
    if (data.action === "remove")
      await env.DB.prepare(
        "DELETE FROM saved_searches WHERE actor=? AND query=? AND mailbox_id IN (" +
          permitted +
          ")",
      )
        .bind(u.id, q, u.id, box)
        .run();
    else if (data.action === "save") {
      const saved = await env.DB.prepare(
        "INSERT INTO saved_searches SELECT id,?,? FROM mailboxes WHERE id IN (" +
          permitted +
          ") AND ((SELECT count(*) FROM saved_searches WHERE actor=? AND mailbox_id=?)<50 OR EXISTS(SELECT 1 FROM saved_searches WHERE actor=? AND mailbox_id=? AND query=?)) ON CONFLICT DO UPDATE SET query=excluded.query RETURNING query",
      )
        .bind(u.id, q, u.id, box, u.id, box, u.id, box, q)
        .first();
      if (!saved) throw new Problem(409, "There are already 50 saved searches in this mailbox");
    } else throw new Problem(400, "Choose save or remove");
  }
  const result = await env.DB.batch([
    env.DB.prepare(
      "SELECT query FROM saved_searches WHERE actor=? AND mailbox_id IN (" +
        permitted +
        ") ORDER BY query",
    ).bind(u.id, u.id, box),
    env.DB.prepare(
      "SELECT DISTINCT label FROM message_labels WHERE mailbox_id IN (" +
        permitted +
        ") ORDER BY label LIMIT 100",
    ).bind(u.id, box),
  ]);
  return { searches: result[0].results, labels: result[1].results };
}
