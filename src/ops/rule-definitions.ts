import { ruleAllowed } from "../agents/delegation";
import * as z from "zod/mini";
import { compileCondition } from "../rule-matcher";
import { Problem, type Bindings, type Principal } from "../env";
import { administrator, canManageDomain, human, mailboxAccess, writable } from "./access";

const text = z.string().check(z.minLength(1), z.maxLength(80), z.regex(/^[^\p{Cc}]+$/u));
const action = z.union([
  z.strictObject({
    kind: z.enum(["webhook", "agent_notify", "notify"]),
    target: z.string().check(z.regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)),
  }),
  z.strictObject({
    kind: z.literal("auto_reply"),
    text: z.string().check(z.minLength(1), z.maxLength(4000)),
    days: z.number().check(z.int(), z.minimum(1), z.maximum(30)),
  }),
  z.strictObject({
    kind: z.literal("forward"),
    mode: z.enum(["relay", "resend"]),
    reply_through: z.optional(z.boolean()),
    destination: z.string().check(z.regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)),
  }),
  z.strictObject({ kind: z.enum(["archive", "spam", "trash", "skip_inbox", "star", "mark_read"]) }),
  z.strictObject({
    kind: z.literal("snooze"),
    minutes: z.number().check(z.int(), z.minimum(1), z.maximum(525600)),
  }),
  z.strictObject({ kind: z.literal("label"), value: text }),
]);
const doc = z.strictObject({
  name: text,
  enabled: z.boolean(),
  stop: z.boolean(),
  order: z.number().check(z.int(), z.minimum(0), z.maximum(9999)),
  condition: z.unknown(),
  actions: z.array(action).check(z.minLength(1), z.maxLength(8)),
});
export type Definition = z.infer<typeof doc>;
export type Rule = {
  rule_id: string;
  revision: number;
  document: string;
  scope: string;
  scope_id: string;
  owner: string;
};
export function definition(input: unknown) {
  const data = doc.safeParse(input);
  if (!data.success)
    throw new Problem(400, "Provide a name, condition and up to eight organization actions");
  try {
    compileCondition(data.data.condition);
  } catch (e) {
    throw new Problem(400, e instanceof Error ? e.message : "Invalid condition");
  }
  return data.data;
}
export const latest =
  "v.revision=(SELECT max(n.revision) FROM rule_versions n WHERE n.rule_id=v.rule_id)";
export const applicable =
  "(v.scope='instance' OR (v.scope='domain' AND v.scope_id=b.domain_id) OR (v.scope='mailbox' AND v.scope_id=b.id))";
export const authorized = `EXISTS(SELECT 1 FROM users u WHERE u.id=v.owner AND u.disabled_at IS NULL AND (
  u.role IN ('owner','admin') OR (v.scope='domain' AND EXISTS(SELECT 1 FROM domain_admins a WHERE a.user_id=u.id AND a.domain_id=v.scope_id))
  OR (v.scope='mailbox' AND EXISTS(SELECT 1 FROM mailbox_members m WHERE m.user_id=u.id AND m.mailbox_id=v.scope_id AND m.role IN ('editor','owner')))))`;
export async function listRules(env: Bindings, p: Principal, box: string) {
  const user = human(p);
  if (
    !(await env.DB.prepare("SELECT b.id " + mailboxAccess + " AND b.id=?")
      .bind(user.id, box)
      .first())
  )
    throw new Problem(404, "Mailbox unavailable");
  const rows =
    await env.DB.prepare(`SELECT v.*, (${authorized} AND ${ruleAllowed}) AS authorized FROM rule_versions v JOIN mailboxes b ON b.id=?
     WHERE ${applicable} AND ${latest} ORDER BY CASE scope WHEN 'instance' THEN 0 WHEN 'domain' THEN 1 ELSE 2 END,json_extract(document,'$.order'),rule_id`)
      .bind(box)
      .all<Rule>();
  return rows.results.map((v) => ({ ...v, document: doc.parse(JSON.parse(v.document)) }));
}
export async function manageScope(env: Bindings, p: Principal, box: string, scope: unknown) {
  const actor = human(p).id;
  const domain = await env.DB.prepare("SELECT domain_id FROM mailboxes WHERE id=?")
    .bind(box)
    .first<string>("domain_id");
  if (!domain) throw new Problem(404, "Mailbox unavailable");
  if (scope === "domain") {
    await canManageDomain(env, p, domain);
    return domain;
  }
  if (scope === "instance") {
    administrator(p);
    return "";
  }
  if (scope !== "mailbox") throw new Problem(400, "Unknown rule scope");
  if (!(await env.DB.prepare(writable).bind(actor, box).first()))
    throw new Problem(403, "Mailbox editor required");
  return box;
}

export const effective = `SELECT v.* FROM rule_versions v JOIN mailboxes b ON b.id=? WHERE ${applicable} AND ${latest} AND ${authorized} AND ${ruleAllowed} AND json_extract(document,'$.enabled')=1
 ORDER BY CASE scope WHEN 'instance' THEN 0 WHEN 'domain' THEN 1 ELSE 2 END,json_extract(document,'$.order'),rule_id`;
