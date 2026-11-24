import { defaultSender } from "./identities";
import { ulid } from "ulid";
import { type Bindings } from "../env";
import { address } from "../address";
import type { Facts } from "../rule-matcher";
import { type Rule, latest } from "./rule-definitions";
import { blocked } from "./forward-claim";
import { provider } from "./outbox";
export type Vacation = { kind: "auto_reply"; text: string; days: number };
const stillOwner = `EXISTS(SELECT 1 FROM users u WHERE u.id=v.owner AND u.disabled_at IS NULL AND
 (u.role IN('admin','owner') OR EXISTS(SELECT 1 FROM mailbox_members mm WHERE mm.user_id=u.id AND mm.mailbox_id=v.scope_id AND mm.role='owner')))`;
export const validVacation = `SELECT 1 FROM vacation_replies r JOIN rule_versions v ON v.rule_id=r.rule_id AND v.revision=r.revision
 WHERE r.id=outbox.id AND ${latest} AND ${stillOwner}`;
function recipient(f: Facts) {
  if (blocked(f) || f["header:list-unsubscribe"]?.length || f["header:list-post"]?.length)
    return null;
  const intended = new Set([...f.to, ...f.cc].map((s) => s.trim().toLowerCase()));
  if (![...f.delivered_to, ...f.alias].some((s) => intended.has(s.toLowerCase()))) return null;
  try {
    const envelope = address(f.envelope_from[0]),
      author = address(f.from[0]);
    if (
      (envelope.host !== author.host && f.spf?.[0] !== "pass") ||
      /^(owner-|mailer-daemon$|postmaster$)|-request$/i.test(envelope.local)
    )
      return null;
    return envelope;
  } catch {
    return null;
  }
}
export async function vacationReply(
  env: Bindings,
  v: Rule,
  a: Vacation,
  box: string,
  message: string,
  facts: Facts,
) {
  const to = recipient(facts);
  if (!to || v.scope !== "mailbox") return [];
  const mailbox = await env.DB.prepare("SELECT address FROM mailboxes WHERE id=?")
    .bind(box)
    .first<string>("address");
  if (!mailbox) return [];
  let mode;
  try {
    mode = provider(env);
  } catch {
    return [];
  }
  if (mode === "cloudflare" && !defaultSender(env, mailbox)) return [];
  const now = Date.now(),
    id = ulid(),
    base = to.local.split("+")[0].toLowerCase() + "@" + to.host;
  // Reserve once per sender across all vacation rules and alias receipts, in the same transaction as the work item.
  const reservation =
    env.DB.prepare(`INSERT INTO vacation_replies(id,mailbox_id,message_id,rule_id,revision,sender,until_ms)
   SELECT ?,m.mailbox_id,m.id,v.rule_id,v.revision,?,? FROM messages m JOIN rule_versions v ON v.rule_id=? AND v.revision=? AND v.scope_id=m.mailbox_id
   WHERE m.id=? AND m.mailbox_id=? AND ${latest} AND ${stillOwner}
   AND NOT EXISTS(SELECT 1 FROM addresses WHERE canonical IN(?,?))
   AND NOT EXISTS(SELECT 1 FROM vacation_replies r WHERE r.mailbox_id=m.mailbox_id AND r.sender=? AND r.until_ms>?)
   ON CONFLICT DO NOTHING`).bind(
      id,
      to.canonical,
      now + a.days * 86400000,
      v.rule_id,
      v.revision,
      message,
      box,
      to.canonical,
      base,
      to.canonical,
      now,
    );
  const letter = JSON.stringify({
    to: [to.canonical],
    cc: [],
    bcc: [],
    subject: "Auto: Away from my mailbox",
    body: a.text,
    vacation: true,
  });
  const submit =
    env.DB.prepare(`INSERT INTO outbox(id,mailbox_id,actor,provider,from_addr,reply_addr,letter,parent,units,state,due_ms,created_at)
   SELECT r.id,r.mailbox_id,?,?,?,?,json_set(?,'$.agent_grant',dg.grant_id,'$.agent_origin',dg.audience),r.message_id,1,'held',?,? FROM vacation_replies r LEFT JOIN delegated_rules dg ON dg.rule_id=r.rule_id AND dg.revision=r.revision WHERE r.id=?`).bind(
      v.owner,
      mode,
      mode === "cloudflare" ? defaultSender(env, mailbox) || "" : mailbox,
      mailbox,
      letter,
      now,
      new Date(now).toISOString(),
      id,
    );
  return [reservation, submit];
}
