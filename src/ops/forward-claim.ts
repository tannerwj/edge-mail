import { ruleAllowed } from "../agents/delegation";
import { createHash } from "node:crypto";
import type { Facts } from "../rule-matcher";
import type { Bindings } from "../env";
import { authorized, latest, type Rule } from "./rule-definitions";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const normalized = (value: string) => value.trim().toLowerCase();
export const instanceId = (env: Pick<Bindings, "CONTENT_ORIGIN" | "ACCESS_AUD">) =>
  hash(env.CONTENT_ORIGIN || env.ACCESS_AUD || "local").slice(0, 32);
export type Claims = {
  box: string;
  source: string;
  sender: string;
  mode: string;
  message?: string;
  hash?: string;
  reason: string | null;
};
const owns = `EXISTS(SELECT 1 FROM users u WHERE u.id=v.owner AND u.disabled_at IS NULL AND (u.role IN ('owner','admin') OR EXISTS(
 SELECT 1 FROM mailbox_members m WHERE m.user_id=u.id AND m.mailbox_id=d.mailbox_id AND m.role='owner')))`;
export function attempt(
  env: Pick<Bindings, "DB">,
  v: Rule,
  dest: string,
  c: Claims,
  id: string,
  outbox: string | null,
) {
  return env.DB.prepare(`INSERT INTO forward_attempts(id,mailbox_id,rule_id,revision,destination,source,sender,mode,state,reason,at,outbox_id,content_hash,source_message)
   SELECT ?,d.mailbox_id,v.rule_id,v.revision,d.id,?,?,?,CASE WHEN ? IS NULL THEN 'claimed' ELSE 'skipped' END,?,?,?,?,?
   FROM rule_versions v JOIN egress_destinations d ON d.id=? JOIN users du ON du.id=d.owner AND du.disabled_at IS NULL
   WHERE v.rule_id=? AND v.revision=? AND ${latest} AND ${authorized} AND ${ruleAllowed} AND ${owns} AND d.mailbox_id=? AND d.disabled=0 AND d.verified_at IS NOT NULL
   AND (? IS NULL OR EXISTS(SELECT 1 FROM messages m WHERE m.id=? AND m.mailbox_id=d.mailbox_id))
   AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM forward_attempts f WHERE f.destination=d.id AND f.content_hash=? AND f.at>=? AND f.state!='skipped'))
   AND NOT EXISTS(SELECT 1 FROM addresses a WHERE a.canonical=d.address OR
    (instr(d.address,'+')>0 AND a.canonical=substr(d.address,1,instr(d.address,'+')-1)||substr(d.address,instr(d.address,'@'))))
   AND (SELECT count(*) FROM forward_attempts f WHERE f.mailbox_id=d.mailbox_id AND f.sender=? AND at>=? AND state!='skipped')<20
   ON CONFLICT(mailbox_id,source,destination) DO NOTHING RETURNING (SELECT address FROM egress_destinations WHERE id=destination) AS address`).bind(
    id,
    c.source,
    c.sender,
    c.mode,
    c.reason,
    c.reason,
    Date.now(),
    outbox,
    c.hash || null,
    c.message || null,
    dest,
    v.rule_id,
    v.revision,
    c.box,
    c.message || null,
    c.message || null,
    c.hash || null,
    c.hash || null,
    Date.now() - 3600000,
    c.sender,
    Date.now() - 3600000,
  );
}
export function blocked(f: Facts) {
  if (f["header:x-edge-mail-loop"]?.length) return "loop_header";
  if (f["header:auto-submitted"]?.some((v) => normalized(v) !== "no")) return "auto_submitted";
  if (
    f["list_id"]?.length ||
    f["header:precedence"]?.some((v) => /^(bulk|list|junk)$/i.test(v.trim()))
  )
    return "automated_list";
  if (f.dmarc?.[0] !== "pass") return "authentication";
  return null;
}
