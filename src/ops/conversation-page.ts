import { type Bindings, Problem } from "../env";
import { mailboxAccess, type User } from "./access";

export async function conversationPage(
  env: Bindings,
  user: User,
  box: string,
  id: string,
  before?: string | null,
) {
  const [at, previous] = (before || "").split("~");
  if (before && (!at || !previous)) throw new Problem(400, "Invalid conversation cursor");
  const scope = `FROM thread_members t JOIN messages m ON m.mailbox_id=t.mailbox_id AND m.id=t.message_id
    WHERE t.mailbox_id IN (SELECT b.id ${mailboxAccess} AND b.id=?) AND t.thread_id=(SELECT thread_id FROM thread_members WHERE mailbox_id=? AND message_id=?)`;
  const params = [user.id, box, box, id];
  const rows = await env.DB.prepare(`SELECT m.id,m.subject,m.sender,m.received_at,m.is_read ${scope}
    ${before ? "AND (m.received_at,m.id)<(?,?)" : ""} ORDER BY m.received_at DESC,m.id DESC LIMIT 101`)
    .bind(...params, ...(before ? [at, previous] : []))
    .all<{ id: string; received_at: string; is_read: number }>();
  const conversation = rows.results.slice(0, 100),
    last = conversation.at(-1);
  const next = rows.results.length > 100 && last ? last.received_at + "~" + last.id : null;
  const found = conversation.find((row) => !row.is_read);
  const latest =
    found?.id ??
    (!before && next
      ? await env.DB.prepare(
          "SELECT m.id " + scope + " AND m.is_read=0 ORDER BY m.received_at DESC,m.id DESC LIMIT 1",
        )
          .bind(...params)
          .first<string>("id")
      : null);
  return { conversation, conversation_next: next, latest_unread: latest };
}
