import { claimLabel } from "./conversation-claim";
import { visibleInbox } from "./thread-views";
import type { Bindings } from "../env";
import { mailboxAccess } from "./access";

// First identify the newest visible member of each conversation in folder index order.
// Only the 51 selected conversations need their remaining visible members summarized.
export function folderList(
  env: Bindings,
  user: string,
  box: string | { domain: string },
  folder: string,
  at: string,
  id: string,
) {
  const selection =
    typeof box === "string" ? " AND b.id=?" : box.domain ? " AND b.domain_id=?" : "";
  const bindings = typeof box === "string" ? [box] : box.domain ? [box.domain] : [];
  const visible = folder === "inbox" ? " AND " + visibleInbox : "";
  const siblingVisible = visible.replaceAll("m.", "newer.").replaceAll("t.", "sibling.");
  const sql = `WITH latest AS MATERIALIZED (
    SELECT m.*,COALESCE(t.thread_id,m.id) AS thread_id
    FROM messages m LEFT JOIN thread_members t ON t.mailbox_id=m.mailbox_id AND t.message_id=m.id
    WHERE m.mailbox_id IN (SELECT b.id ${mailboxAccess}${selection}) AND m.folder=? ${visible} ${at ? "AND (m.received_at,m.id)<(?,?)" : ""}
      AND NOT EXISTS(SELECT 1 FROM thread_members sibling INDEXED BY conversation_messages CROSS JOIN messages newer ON newer.id=sibling.message_id
        WHERE sibling.mailbox_id=m.mailbox_id AND sibling.thread_id=t.thread_id AND newer.folder=m.folder ${siblingVisible}
          AND (newer.received_at,newer.id)>(m.received_at,m.id))
    ORDER BY m.received_at DESC,m.id DESC LIMIT 51
  ), stats AS (
    SELECT l.id,count(m.id) AS n,MIN(m.is_read) AS all_read,MAX(m.starred) AS any_star FROM latest l
    CROSS JOIN thread_members t INDEXED BY conversation_messages ON t.mailbox_id=l.mailbox_id AND t.thread_id=l.thread_id
    CROSS JOIN messages m ON m.id=t.message_id AND m.folder=l.folder ${visible} GROUP BY l.id
  )
  SELECT ${claimLabel("l")} AS claimed_by,l.id,l.mailbox_id,l.sender,md.recipients,md.cc,l.subject,l.snippet,l.received_at,l.attachment_count,l.folder,l.thread_id,
    COALESCE(s.all_read,l.is_read) AS is_read,COALESCE(s.any_star,l.starred) AS starred,COALESCE(s.n,1) AS message_count
    FROM latest l LEFT JOIN message_metadata md ON md.message_id=l.id LEFT JOIN stats s ON s.id=l.id ORDER BY l.received_at DESC,l.id DESC`;
  return env.DB.prepare(sql).bind(user, ...bindings, folder, ...(at ? [at, id] : []));
}
