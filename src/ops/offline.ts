import { createHash } from "node:crypto";
import { type Bindings, Problem } from "../env";
import { mailboxAccess, type User } from "./access";

export async function offline(env: Bindings, user: User, expires: number, url: URL) {
  if (!Number.isFinite(expires) || expires <= Date.now()) throw new Problem(401, "Session expired");
  const boxes = await env.DB.prepare("SELECT b.id " + mailboxAccess + " ORDER BY b.id")
    .bind(user.id)
    .all<{ id: string }>();
  const scope = createHash("sha256")
    .update(JSON.stringify(boxes.results.map((b) => b.id)))
    .digest("hex");
  const session = { user: user.id, scope, expires };
  if (url.pathname === "/api/offline/session") return session;
  if (url.searchParams.get("scope") !== scope) throw new Problem(409, "Mailbox access changed");
  const before = url.searchParams.get("before") || "";
  const [at, id] = before.split("~");
  if (before && (!at || !id)) throw new Problem(400, "Invalid page cursor");
  const rows =
    await env.DB.prepare(`SELECT m.id,m.received_at,m.sender,m.subject,m.body_key,b.display_name AS mailbox,
      coalesce(t.thread_id,m.id) AS thread FROM messages m JOIN mailboxes b ON b.id=m.mailbox_id
      LEFT JOIN thread_members t ON t.mailbox_id=m.mailbox_id AND t.message_id=m.id
      WHERE m.mailbox_id IN (SELECT b.id ${mailboxAccess}) AND m.folder IN ('inbox','archive','sent')
      AND (?='' OR (m.received_at,m.id)<(?,?)) AND NOT EXISTS(
        SELECT 1 FROM thread_members sibling INDEXED BY conversation_messages CROSS JOIN messages newer ON newer.id=sibling.message_id
        WHERE sibling.mailbox_id=m.mailbox_id AND sibling.thread_id=t.thread_id AND newer.folder IN ('inbox','archive','sent')
        AND (newer.received_at,newer.id)>(m.received_at,m.id))
      ORDER BY m.received_at DESC,m.id DESC LIMIT 11`)
      .bind(user.id, before, at, id || "")
      .all<{
        id: string;
        received_at: string;
        sender: string;
        subject: string;
        body_key: string;
        mailbox: string;
        thread: string;
      }>();
  const items = rows.results.slice(0, 10);
  const threads = await Promise.all(
    items.map(async ({ body_key, ...row }) => {
      const object = await env.MAIL.get(body_key, { range: { offset: 0, length: 65536 } });
      if (!object) throw new Problem(503, "Offline body unavailable");
      return { ...row, text: await object.text(), truncated: object.size > 65536 };
    }),
  );
  const last = items.at(-1);
  return {
    ...session,
    threads,
    next: rows.results.length > 10 && last ? last.received_at + "~" + last.id : null,
  };
}
