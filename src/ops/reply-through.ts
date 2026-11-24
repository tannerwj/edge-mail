import { ulid } from "ulid";
import { contentKey } from "../instance-key";
import { address } from "../address";
import type { Bindings } from "../env";
import { authorized, latest } from "./rule-definitions";
import { ruleAllowed } from "../agents/delegation";
import type { Receipt } from "./receipt";
import type { Facts } from "../rule-matcher";
import { blocked } from "./forward-claim";
export async function signedAlias(env: Bindings, box: string, id: string, mailbox: string) {
  const key = await contentKey(env, true);
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("edge-mail reply-through v1\0" + box + "\0" + id),
  );
  const [local, domain] = mailbox.split("@");
  return address(local + "+emr-" + Buffer.from(mac).subarray(0, 16).toString("hex") + "@" + domain)
    .canonical;
}
const active = ` FROM outbox o JOIN forward_attempts f ON f.outbox_id=o.id JOIN egress_destinations d ON d.id=f.destination AND d.disabled=0 AND d.verified_at IS NOT NULL
 JOIN users du ON du.id=d.owner AND du.disabled_at IS NULL JOIN rule_versions v ON v.rule_id=f.rule_id AND v.revision=f.revision
 JOIN messages m ON m.id=f.source_message AND m.mailbox_id=f.mailbox_id AND m.body_key!='erased'
 WHERE json_extract(o.letter,'$.replyAlias') IS NOT NULL AND o.state='sent' AND f.state='submitted' AND f.at>unixepoch()*1000-604800000
 AND ${latest} AND ${authorized} AND ${ruleAllowed} AND (v.owner IN (SELECT id FROM users WHERE role IN('admin','owner') AND disabled_at IS NULL) OR EXISTS(SELECT 1 FROM mailbox_members mm WHERE mm.mailbox_id=f.mailbox_id AND mm.user_id=v.owner AND mm.role='owner'))`;
export const validReply =
  "EXISTS(SELECT 1" +
  active +
  " AND o.id=json_extract(outbox.letter,'$.replyForward') AND EXISTS(SELECT 1 FROM messages r WHERE r.id=json_extract(outbox.letter,'$.replySource') AND r.mailbox_id=outbox.mailbox_id))";
export async function resolveReply(env: { DB: D1Database }, canonical: string) {
  const r = await env.DB.prepare(
    "SELECT o.mailbox_id,json_extract(o.letter,'$.replyAlias') address" +
      active +
      " AND json_extract(o.letter,'$.replyAlias')=? AND NOT EXISTS(SELECT 1 FROM outbox used WHERE json_extract(used.letter,'$.replyForward')=o.id)",
  )
    .bind(canonical)
    .first<{ mailbox_id: string; address: string }>();
  return r ? { ...r, kind: "reply-through", tag: null } : null;
}
export function queueReply(env: Bindings, meta: Receipt, id: string, facts: Facts, body: string) {
  if (
    blocked(facts) ||
    !facts.reply_author[0] ||
    body.length > 65536 ||
    facts.has_attachment[0] === "true" ||
    !body.trim()
  )
    return [];
  const sender = facts.reply_author[0];
  if (sender !== meta.from.trim().toLowerCase()) return [];
  // Both the envelope sender and authenticated author must be the verified destination. Never use To/Cc or Reply-To from this reply.
  return [
    env.DB.prepare(
      `INSERT INTO outbox(id,mailbox_id,actor,provider,from_addr,reply_addr,letter,units,state,due_ms,created_at,parent)
 SELECT ?,o.mailbox_id,o.actor,o.provider,o.from_addr,o.reply_addr,json_object('to',json_array(m.sender),'cc',json_array(),'bcc',json_array(),'subject',?,'body',?,'replyForward',o.id,'replySource',?,'agent_grant',json_extract(o.letter,'$.agent_grant'),'agent_origin',json_extract(o.letter,'$.agent_origin')),1,'held',?,?,m.id
 ` +
        active +
        ` AND json_extract(o.letter,'$.replyAlias')=? AND d.address=? AND o.mailbox_id=? AND EXISTS(SELECT 1 FROM messages r WHERE r.id=? AND r.mailbox_id=o.mailbox_id)
 AND NOT EXISTS(SELECT 1 FROM addresses a WHERE a.canonical=lower(m.sender)) AND NOT EXISTS(SELECT 1 FROM temporary_addresses a WHERE a.canonical=lower(m.sender))
 ON CONFLICT DO NOTHING`,
    ).bind(
      ulid(),
      ("Re: " + (facts.subject[0] || "").replace(/^(?:re:|fwd:)\s*/gi, "")).slice(0, 800),
      body,
      id,
      Date.now(),
      new Date().toISOString(),
      meta.matched,
      sender,
      meta.mailbox,
      id,
    ),
  ];
}
