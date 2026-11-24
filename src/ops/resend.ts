import { signedAlias } from "./reply-through";
import { defaultSender } from "./identities";
import { ulid } from "ulid";
import { address } from "../address";
import type { Bindings } from "../env";
import type { Facts } from "../rule-matcher";
import type { ForwardAction } from "./forward";
import { blocked, attempt } from "./forward-claim";
import type { Rule } from "./rule-definitions";
import { provider } from "./outbox";
export async function queuedResend(
  env: Bindings,
  v: Rule,
  a: ForwardAction,
  box: string,
  message: string,
  facts: Facts,
) {
  const mailbox = await env.DB.prepare("SELECT address FROM mailboxes WHERE id=?")
    .bind(box)
    .first<string>("address");
  if (!mailbox) return [];
  const from = facts.from[0],
    subject = facts.subject[0],
    id = ulid();
  let reason = blocked(facts);
  let mode = "off",
    reply = "";
  try {
    mode = provider(env);
    reply = address(from).canonical;
  } catch {
    reason ||= "sending_unavailable";
  }
  if (mode === "cloudflare" && !defaultSender(env, mailbox)) reason ||= "identity_unavailable";
  const content = facts.parsed_digest[0];
  const source = facts["header:message-id"]?.[0] || content;
  const claim = attempt(
    env,
    v,
    a.destination,
    {
      box,
      message,
      source,
      sender: facts.envelope_from[0].toLowerCase(),
      mode: "resend",
      hash: content,
      reason,
    },
    id,
    id,
  );
  const insert =
    env.DB.prepare(`INSERT INTO outbox(id,mailbox_id,actor,provider,from_addr,reply_addr,letter,units,state,due_ms,created_at)
    SELECT f.id,f.mailbox_id,?,?,?,?,json_object('to',json_array(d.address),'cc',json_array(),'bcc',json_array(),'subject',?,'body',?,'forwardedFrom',?,'replyAlias',?,'agent_grant',dg.grant_id,'agent_origin',dg.audience),1,'held',?,? FROM forward_attempts f
    JOIN egress_destinations d ON d.id=f.destination LEFT JOIN delegated_rules dg ON dg.rule_id=f.rule_id AND dg.revision=f.revision WHERE f.id=? AND f.state='claimed'`).bind(
      v.owner,
      mode,
      mode === "cloudflare" ? defaultSender(env, mailbox) || "" : mailbox,
      mailbox,
      "Fwd: " + subject.slice(0, 800),
      "Forwarded message from " +
        from +
        ". The complete original is attached." +
        (a.reply_through
          ? " Reply from this verified address within seven days. One text reply of up to 65,536 characters can be delivered through the mailbox. Attachments require composing in the app."
          : ""),
      reply,
      a.reply_through ? await signedAlias(env, box, id, mailbox) : null,
      Date.now(),
      new Date().toISOString(),
      id,
    );
  return [claim, insert];
}
export const forwardPermitted = `SELECT 1 FROM forward_attempts f JOIN egress_destinations d ON d.id=f.destination
 JOIN rule_versions v ON v.rule_id=f.rule_id AND v.revision=f.revision JOIN users u ON u.id=v.owner JOIN users du ON du.id=d.owner
 WHERE f.outbox_id=outbox.id AND f.state='claimed' AND d.disabled=0 AND d.verified_at IS NOT NULL AND u.disabled_at IS NULL AND du.disabled_at IS NULL
 AND v.revision=(SELECT max(revision) FROM rule_versions WHERE rule_id=v.rule_id)
 AND (u.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM mailbox_members mm WHERE mm.mailbox_id=d.mailbox_id AND mm.user_id=u.id AND mm.role='owner'))
 AND NOT EXISTS(SELECT 1 FROM addresses recv WHERE recv.canonical=d.address OR
  (instr(d.address,'+')>0 AND recv.canonical=substr(d.address,1,instr(d.address,'+')-1)||substr(d.address,instr(d.address,'@'))))`;

export async function originalMail(env: Bindings, box: string, id: string) {
  const path =
    await env.DB.prepare(`SELECT d.raw_key FROM deliveries d JOIN forward_attempts f ON f.mailbox_id=d.mailbox_id AND f.source_message=d.message_id
    WHERE f.outbox_id=? AND f.mailbox_id=? ORDER BY d.received_at,d.id LIMIT 1`)
      .bind(id, box)
      .first<string>("raw_key");
  const raw = path ? await env.MAIL.get(path) : null;
  if (!raw) throw new Error("Forward source unavailable");
  return raw;
}
