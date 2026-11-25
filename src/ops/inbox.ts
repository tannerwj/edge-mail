import { storedProtection } from "../mail-protection";
import { listTarget } from "./list-unsubscribe";
import { threadState } from "./thread-views";
import { deliverySummary } from "./delivery-summary";
import { type Bindings, type Principal, Problem } from "../env";
import { human, mailboxAccess } from "./access";
import { folderList } from "./folder-list";
import { filterMessages } from "./filter";

export async function inbox(
  env: Bindings,
  p: Principal,
  mailbox: string | { domain: string },
  search: URLSearchParams,
) {
  const id = human(p).id;
  if (
    typeof mailbox === "string" &&
    !(await env.DB.prepare(`SELECT b.id ${mailboxAccess} AND b.id=?`).bind(id, mailbox).first())
  )
    throw new Problem(404, "Mailbox unavailable");
  let at = "",
    messageId = "";
  const before = search.get("before"),
    filter = filterMessages(search);
  if (before) {
    [at, messageId] = before.split("~");
    if (!at || !messageId) throw new Problem(400, "Invalid page cursor");
  }
  const grouped = search.get("group") === "thread";
  const selection =
    typeof mailbox === "string" ? " AND b.id=?" : mailbox.domain ? " AND b.domain_id=?" : "";
  const bindings = typeof mailbox === "string" ? [mailbox] : mailbox.domain ? [mailbox.domain] : [];
  const base = `SELECT m.id,m.mailbox_id,m.sender,md.recipients,md.cc,m.subject,m.snippet,m.received_at,m.attachment_count,m.folder,m.is_read,m.starred,
    COALESCE(t.thread_id,m.id) AS thread_id FROM messages m LEFT JOIN message_metadata md ON md.message_id=m.id
    LEFT JOIN thread_members t ON t.mailbox_id=m.mailbox_id AND t.message_id=m.id
    WHERE m.mailbox_id IN (SELECT b.id ${mailboxAccess}${selection}) AND ${filter.sql}`;
  const visible = grouped
    ? `SELECT id,mailbox_id,sender,recipients,cc,subject,snippet,received_at,attachment_count,folder,all_read AS is_read,any_star AS starred,thread_id,message_count
    FROM (SELECT hits.*,ROW_NUMBER() OVER (PARTITION BY mailbox_id,thread_id ORDER BY received_at DESC,id DESC) AS position,
    MIN(is_read) OVER (PARTITION BY mailbox_id,thread_id) AS all_read,MAX(starred) OVER (PARTITION BY mailbox_id,thread_id) AS any_star,
    COUNT(*) OVER (PARTITION BY mailbox_id,thread_id) AS message_count FROM hits) WHERE position=1`
    : "SELECT hits.*,1 AS message_count FROM hits";
  const general =
    env.DB.prepare(`WITH hits AS (${base}), visible AS (${visible}) SELECT * FROM visible
    WHERE (?='' OR (received_at,id)<(?,?)) ORDER BY received_at DESC,id DESC LIMIT 51`).bind(
      id,
      ...bindings,
      ...filter.params,
      at,
      at,
      messageId,
    );
  const folder = search.get("folder") || "inbox";
  const simple =
    grouped && !search.get("q") && ["inbox", "archive", "spam", "trash", "sent"].includes(folder);
  const statement = simple ? folderList(env, id, mailbox, folder, at, messageId) : general;
  const rows = await statement.all<{ id: string; received_at: string }>();
  const messages = rows.results.slice(0, 50),
    last = messages.at(-1);
  return {
    messages,
    next: rows.results.length > 50 && last ? last.received_at + "~" + last.id : null,
  };
}
export async function readMessage(env: Bindings, p: Principal, mailbox: string, id: string) {
  const message =
    await env.DB.prepare(`SELECT (SELECT recipients FROM message_metadata WHERE message_id=messages.id) recipients,(SELECT cc FROM message_metadata WHERE message_id=messages.id) cc,id,sender,subject,received_at,attachment_count,body_key,folder,is_read,starred,EXISTS(SELECT 1 FROM outbox o WHERE o.id=messages.id AND o.mailbox_id=messages.mailbox_id AND json_extract(o.letter,'$.html') IS NOT NULL) AS sent_html,(SELECT reason FROM mail_assessment WHERE message_id=messages.id) AS screening FROM messages
    WHERE id=? AND mailbox_id IN (SELECT b.id ${mailboxAccess} AND b.id=?)`)
      .bind(id, human(p).id, mailbox)
      .first<{ id: string; body_key: string; folder: string; sent_html: number }>();
  if (!message) throw new Problem(404, "Message unavailable");
  const body = await env.MAIL.get(message.body_key);
  if (!body) throw new Problem(503, "Message body unavailable");
  const deliveries =
    await env.DB.prepare(`SELECT raw_key,id,envelope_to,matched_address,kind,plus_tag,received_at,auth
    FROM deliveries WHERE mailbox_id=? AND message_id=? ORDER BY received_at,id`)
      .bind(mailbox, id)
      .all<{ raw_key: string }>();
  const { body_key: _bodyKey, sent_html, ...fields } = message;
  const labels = await env.DB.prepare(
    "SELECT label FROM message_labels WHERE mailbox_id=? AND message_id=? ORDER BY label",
  )
    .bind(mailbox, id)
    .all<{ label: string }>();
  const conversation =
    await env.DB.prepare(`SELECT m.id,m.subject,m.sender,m.received_at FROM thread_members t
    JOIN messages m ON m.mailbox_id=t.mailbox_id AND m.id=t.message_id
    WHERE t.mailbox_id IN (SELECT b.id ${mailboxAccess} AND b.id=?) AND t.thread_id=(SELECT thread_id FROM thread_members WHERE mailbox_id=? AND message_id=?)
    ORDER BY m.received_at DESC,m.id DESC LIMIT 100`)
      .bind(human(p).id, mailbox, mailbox, id)
      .all();
  return {
    ...fields,
    protection: await storedProtection(
      env,
      deliveries.results[0]?.raw_key || null,
      body.customMetadata?.protection,
    ),
    unsubscribeHost:
      body.customMetadata?.list === "no"
        ? null
        : (await listTarget(env, human(p).id, mailbox, id))?.host || null,
    deliveryStatus: message.folder === "sent" ? await deliverySummary(env, mailbox, id) : [],
    conversation: conversation.results,
    thread: await threadState(env, mailbox, id),
    labels: labels.results.map((l) => l.label),
    formatted:
      !!env.CONTENT_ORIGIN &&
      (deliveries.results.length > 0 || !!sent_html) &&
      body.customMetadata?.formatted !== "no",
    body: await body.text(),
    deliveries: deliveries.results.map(({ raw_key: _, ...delivery }) => delivery),
  };
}
