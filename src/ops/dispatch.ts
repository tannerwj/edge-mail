import { writable } from "./access";
import { validReply } from "./reply-through";
import { overGrantCap } from "../agents/policies";
import { indexText } from "../index-text";
import { mappings } from "./identities";
import { jobAllowed } from "../agents/delegation";
import { validVacation } from "./vacation";
import { forwardPermitted, originalMail } from "./resend";
import { instanceId } from "./forward-claim";
import { storedFiles } from "./compose-files";
import { sentLayout, renderMime } from "./sent-mime";
import { changed } from "../live";
import { type Bindings } from "../env";
import { messageIds, replyReferences, subjectKey } from "../threading";
import { type Item, type Outgoing, provider } from "./outbox";
import { budgetClaims, dailyLimit } from "./budgets";
const day = () => new Date().toISOString().slice(0, 10);
async function claim(env: Bindings, id: string) {
  const now = Date.now();
  const due =
    " WHERE id=? AND state IN ('held','deferred') AND due_ms<=? AND NOT EXISTS(SELECT 1 FROM agent_reviews ar WHERE ar.id=outbox.id AND ar.state!='approved')";
  const permitted = writable
    .replace("u.id=?", "u.id=outbox.actor")
    .replace("b.id=?", "b.id=outbox.mailbox_id");
  let mode;
  try {
    mode = provider(env);
  } catch {
    mode = "off";
  }
  const rows = await env.DB.batch<Item>([
    env.DB.prepare(
      "UPDATE outbox SET state='failed',error_code='authorization_changed',reserved_day=NULL" +
        due +
        ` AND (provider!=? OR (provider='cloudflare' AND NOT EXISTS(SELECT 1 FROM json_each(?) j JOIN mailboxes b ON b.id=outbox.mailbox_id WHERE json_extract(j.value,'$.from')=outbox.from_addr AND json_extract(j.value,'$.mailbox')=lower(b.address) AND outbox.reply_addr=lower(b.address))) OR (provider='capture' AND NOT EXISTS(SELECT 1 FROM addresses a WHERE a.mailbox_id=outbox.mailbox_id AND a.canonical=outbox.from_addr)) OR NOT EXISTS(${permitted}) OR (json_extract(letter,'$.agent_grant') IS NOT NULL AND NOT ${jobAllowed}) OR (json_extract(letter,'$.replyForward') IS NOT NULL AND NOT ${validReply}) OR (EXISTS(SELECT 1 FROM vacation_replies WHERE id=outbox.id) AND NOT EXISTS(${validVacation})) OR (EXISTS(SELECT 1 FROM forward_attempts WHERE outbox_id=outbox.id) AND NOT EXISTS(${forwardPermitted})))`,
    ).bind(id, now, mode, JSON.stringify(mappings(env))),
    env.DB.prepare(
      "UPDATE outbox SET state='deferred',error_code='grant_daily_limit',due_ms=unixepoch('now','start of day','+1 day')*1000" +
        due +
        " AND " +
        overGrantCap,
    ).bind(id, now),
    env.DB.prepare(
      "UPDATE outbox SET state='deferred',error_code='budget_or_pause',due_ms=?" +
        due +
        " AND ((SELECT paused FROM outbox_control WHERE id=1)=1 OR (SELECT COALESCE(SUM(units),0) FROM send_reservations o WHERE o.day=? AND o.item!=outbox.id)+units>?)",
    ).bind(now + 3600000, id, now, day(), dailyLimit),
    ...budgetClaims(env, id, now, due),
    env.DB.prepare(
      "UPDATE outbox SET state='claimed',claimed_ms=?,reserved_day=?,attempts=attempts+1,error_code=NULL" +
        due +
        " RETURNING *",
    ).bind(now, day(), id, now),
  ]);
  return rows.at(-1)?.results.at(0);
}
async function prepare(env: Bindings, item: Item, m: Outgoing) {
  const headers: Record<string, string> = {};
  if (m.replyForward) headers["X-Edge-Mail-Loop"] = instanceId(env);
  if (m.vacation) {
    headers["Auto-Submitted"] = "auto-replied";
    headers["X-Edge-Mail-Loop"] = instanceId(env);
  }
  if (item.parent) {
    const parent = await env.DB.prepare(
      "SELECT m.wire_id,h.reference_ids FROM messages m LEFT JOIN reply_headers h ON h.message_id=m.id WHERE m.mailbox_id=? AND m.id=? AND m.synthetic=0",
    )
      .bind(item.mailbox_id, item.parent)
      .first<{ wire_id: string; reference_ids: string }>();
    if (parent && replyReferences("", parent.wire_id) === parent.wire_id) {
      headers["In-Reply-To"] = parent.wire_id;
      headers.References = replyReferences(parent.reference_ids || "", parent.wire_id);
    }
  }
  const prefix = "sent/" + item.mailbox_id + "/" + item.id;
  const original = m.forwardedFrom ? await originalMail(env, item.mailbox_id, item.id) : null;
  if (original) m.files = [{ id: item.id, name: "original-message.eml", size: original.size }];
  if (m.forwardedFrom) {
    headers["X-Edge-Mail-Loop"] = instanceId(env);
    headers["X-Original-From"] = m.forwardedFrom;
  }
  const layout = sentLayout(
    { ...item, reply_addr: m.replyAlias || m.forwardedFrom || item.reply_addr },
    m,
    headers,
  );
  if (layout.size > 25 * 1024 * 1024) throw new Error("E_HEADER_MESSAGE_TOO_LARGE");
  const attachments = original
    ? [
        {
          filename: "original-message.eml",
          type: "application/octet-stream",
          disposition: "attachment" as const,
          content: await original.arrayBuffer(),
        },
      ]
    : await storedFiles(env, item.mailbox_id, item.id, m.files || [], true);
  const copy = renderMime(layout.pieces, attachments);
  const store = async (key: string, value: string | Blob) => {
    await env.MAIL.put(key, value, { onlyIf: { etagDoesNotMatch: "*" } });
  };
  await Promise.all([
    store(prefix + ".eml", copy),
    store(
      prefix + ".envelope.json",
      JSON.stringify({
        from: item.from_addr,
        to: m.to,
        cc: m.cc,
        bcc: m.bcc,
        format: "builder rendering",
      }),
    ),
    store(prefix + ".txt", m.body),
  ]);
  return { headers, prefix, attachments, size: layout.size };
}
async function accepted(
  env: Bindings,
  item: Item,
  m: Outgoing,
  prepared: Awaited<ReturnType<typeof prepare>>,
  providerId: string,
) {
  const { prefix, size, headers } = prepared;
  const references = headers.References || "";
  // The live Cloudflare builder returns the bracketed Message-ID observed at the recipient.
  const wireId =
    item.provider === "cloudflare" && messageIds(providerId)[0] === providerId ? providerId : "";
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE outbox SET state='sent',letter=json_remove(letter,'$.undo_source','$.restore_draft'),provider_id=? WHERE id=? AND state='claimed'",
    ).bind(providerId, item.id),
    env.DB.prepare(`INSERT INTO messages(id,mailbox_id,content_hash,wire_id,synthetic,sender,subject,snippet,body_key,received_at,attachment_count,folder,is_read)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'sent',1)`).bind(
      item.id,
      item.mailbox_id,
      "sent-" + item.id,
      wireId,
      Number(!wireId),
      item.from_addr,
      m.subject,
      m.body.slice(0, 180),
      prefix + ".txt",
      item.created_at,
      m.files?.length || 0,
    ),
    env.DB.prepare(
      "INSERT INTO search_fts(rowid,subject,body_text) SELECT rowid,subject,? FROM messages WHERE id=?",
    ).bind(indexText(m.body), item.id),
    env.DB.prepare(
      "INSERT INTO thread_members VALUES (?,?,COALESCE((SELECT thread_id FROM thread_members WHERE mailbox_id=? AND message_id=?),?),?,?,0)",
    ).bind(
      item.mailbox_id,
      item.id,
      item.mailbox_id,
      item.parent,
      item.id,
      item.from_addr,
      subjectKey(m.subject),
    ),
    env.DB.prepare("INSERT INTO reply_headers VALUES (?,?,?)").bind(
      item.id,
      item.reply_addr,
      references,
    ),
    env.DB.prepare("INSERT INTO message_metadata VALUES (?,?,?,?)").bind(
      item.id,
      size,
      m.to.join("\n"),
      m.cc.join("\n"),
    ),
  ]);
}
async function failure(env: Bindings, item: Item, error: unknown, submitted: boolean) {
  const message = error instanceof Error ? error.message : "";
  const structured =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  const code = (structured + " " + message).match(/\bE_[A-Z_]+\b/)?.[0] || "transport_unknown";
  const retry = [
    "E_EMAIL_SENDING_NOT_READY",
    "E_RATE_LIMIT_EXCEEDED",
    "E_DAILY_LIMIT_EXCEEDED",
  ].includes(code);
  const rejected =
    code.startsWith("E_HEADER_") ||
    ["E_ACCOUNT_SUSPENDED", "E_RECIPIENT_SUPPRESSED", "E_INVALID_RECIPIENT"].includes(code);
  const state = retry ? "deferred" : rejected ? "failed" : submitted ? "uncertain" : "deferred";
  const due = Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(item.attempts, 6));
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE outbox SET state=?,error_code=?,due_ms=?,reserved_day=CASE WHEN ?='uncertain' THEN reserved_day ELSE NULL END WHERE id=? AND state='claimed'",
    ).bind(state, code, due, state, item.id),
    env.DB.prepare(
      "UPDATE outbox_control SET paused=1 WHERE id=1 AND ?='E_ACCOUNT_SUSPENDED'",
    ).bind(code),
  ]);
}
export async function dispatch(env: Bindings, id: string) {
  const item = await claim(env, id);
  if (!item) return;
  const m: Outgoing = JSON.parse(item.letter);
  let submitting = false,
    acknowledged = false;
  try {
    const prepared = await prepare(env, item, m);
    const { headers, attachments } = prepared;
    const binding = env.OUTBOUND;
    if (item.provider !== "capture" && !binding) throw new Error("Missing send binding");
    submitting = true;
    const providerId =
      !binding || item.provider === "capture"
        ? "capture-" + item.id
        : (
            await binding.send({
              from: item.from_addr,
              replyTo: m.replyAlias || m.forwardedFrom || item.reply_addr,
              to: m.to,
              cc: m.cc,
              bcc: m.bcc,
              subject: m.subject,
              text: m.body,
              ...(m.html ? { html: m.html } : {}),
              headers,
              ...(attachments.length ? { attachments } : {}),
            })
          ).messageId;
    acknowledged = true;
    await accepted(env, item, m, prepared, providerId);
    await changed(env, item.mailbox_id);
  } catch (error) {
    await failure(env, item, acknowledged ? new Error("lost acknowledgement") : error, submitting);
  }
}
export async function sweepOutbox(env: Bindings) {
  const now = Date.now();
  await env.DB.prepare(
    "UPDATE outbox SET state='uncertain',error_code='lost_ack' WHERE state='claimed' AND claimed_ms<?",
  )
    .bind(now - 600000)
    .run();
  await env.DB.prepare(
    "UPDATE forward_attempts SET state='uncertain',reason='lost_ack' WHERE mode='relay' AND state='claimed' AND at<?",
  )
    .bind(now - 600000)
    .run();
  const rows = await env.DB.prepare(
    "SELECT id FROM outbox WHERE state IN ('held','deferred') AND due_ms<=? AND NOT EXISTS(SELECT 1 FROM agent_reviews ar WHERE ar.id=outbox.id AND ar.state!='approved') ORDER BY due_ms LIMIT 8",
  )
    .bind(now)
    .all<{ id: string }>();
  for (const item of rows.results) await dispatch(env, item.id);
}
