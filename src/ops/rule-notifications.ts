import type { Bindings, Principal } from "../env";
import { Problem } from "../env";
import { owner, owning } from "./destinations";
import { latest, authorized, type Definition } from "./rule-definitions";
import { ruleAllowed } from "../agents/delegation";
export const isOutboundAction = (a: Definition["actions"][number]) =>
  ["forward", "auto_reply", "webhook", "agent_notify", "notify"].includes(a.kind);
const members =
  "SELECT u.id,min(e.email) email FROM users u JOIN user_emails e ON e.user_id=u.id WHERE u.disabled_at IS NULL AND (u.id=? OR EXISTS(SELECT 1 FROM mailbox_members m WHERE m.user_id=u.id AND m.mailbox_id=?)) GROUP BY u.id";
const hooks = "SELECT id,host FROM webhooks WHERE enabled=1 AND mailbox_id=?";
export async function notificationTargets(env: Bindings, p: Principal, box: string) {
  const actor = await owner(env, p, box);
  const [people, receivers] = await env.DB.batch([
    env.DB.prepare(members + " ORDER BY email LIMIT 300").bind(actor, box),
    env.DB.prepare(hooks + " ORDER BY host").bind(box),
  ]);
  return { people: people.results, hooks: receivers.results };
}
export async function checkNotificationTargets(
  env: Bindings,
  p: Principal,
  box: string,
  scope: string,
  doc: Definition,
) {
  for (const a of doc.actions) {
    if (!("target" in a)) continue;
    if (scope !== "mailbox") throw new Problem(400, "Choose the mailbox for this notification");
    const actor = await owner(env, p, box);
    if (!doc.enabled) continue;
    const target =
      a.kind === "notify"
        ? env.DB.prepare("SELECT 1 FROM (" + members + ") WHERE id=?").bind(actor, box, a.target)
        : env.DB.prepare(hooks + " AND id=?").bind(box, a.target);
    if (!(await target.first()))
      throw new Problem(409, "Choose an available mailbox member or webhook");
  }
}
type Notice = Extract<Definition["actions"][number], { target: string }>;
export function queueRuleNotice(
  env: Bindings,
  a: Notice,
  box: string,
  run: { id: string; rule: string; execution: string },
  gate: { sql: string; args: (string | number)[] },
) {
  if (a.kind === "notify")
    return env.DB.prepare(
      "INSERT OR IGNORE INTO push_jobs(event,device,mailbox_id,topic,due) SELECT ?,d.id,?,'rule',? FROM push_devices d WHERE d.actor=? AND d.new_mail=1 AND " +
        gate.sql,
    ).bind(run.rule + ":" + run.id, box, Date.now(), a.target, ...gate.args);
  return env.DB.prepare(
    "INSERT OR IGNORE INTO webhook_jobs(id,hook,kind,resource,event_key,detail,created,due,version) SELECT lower(hex(randomblob(16))),id,'rule.matched',?,?,?,unixepoch()*1000,unixepoch()*1000,version FROM webhooks WHERE enabled=1 AND id=? AND mailbox_id=? AND " +
      gate.sql,
  ).bind(run.id, run.execution + run.rule, run.rule, a.target, box, ...gate.args);
}
export async function activeNotification(env: Bindings, box: string, rule: string, id: string) {
  return !!(await env.DB.prepare(
    "SELECT 1 FROM rule_runs r JOIN rule_versions v ON r.rule_id=v.rule_id AND r.revision=v.revision WHERE r.mailbox_id=? AND r.rule_id=? AND r.message_id=? AND json_extract(v.document,'$.enabled')=1 AND " +
      latest +
      " AND " +
      authorized +
      " AND " +
      ruleAllowed +
      " AND (NOT EXISTS(SELECT 1 FROM json_each(r.actions) a WHERE json_extract(a.value,'$.kind') IN('notify','webhook','agent_notify')) OR EXISTS(" +
      owning.replace("u.id=?", "u.id=v.owner").replace("b.id=?", "b.id=r.mailbox_id") +
      "))",
  )
    .bind(box, rule, id)
    .first());
}
