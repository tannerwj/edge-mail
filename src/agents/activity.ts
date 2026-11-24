import { timerOperations, undoTimer } from "../ops/thread-state";
import { changeHook } from "../ops/webhooks";
import { type Bindings, Problem } from "../env";
import type { User } from "../ops/access";
import { owning } from "../ops/destinations";
import { mailboxAccess } from "../ops/access";
import { ruleChange } from "../ops/rules";
import { undoTriage } from "./audit";
import type { Credential } from "./grants";
const eligible = ` FROM agent_audit a JOIN agent_grants g ON g.id=a.grant_id WHERE a.mailbox_id IN (SELECT b.id ${mailboxAccess} AND b.id=?) AND (a.actor=? OR EXISTS(${owning}))`;
export async function activity(env: Bindings, user: User, box: string) {
  return (
    await env.DB.prepare(
      `SELECT a.id,a.op,a.at,a.affected,g.name,
 CASE WHEN a.op='message_triage' THEN EXISTS(SELECT 1 FROM triage_undo t WHERE t.audit_id=a.id AND undone=0)
 WHEN a.op IN ('thread_mute','thread_snooze','thread_follow_up') THEN EXISTS(SELECT 1 FROM timer_undo u JOIN thread_state s ON s.revision=u.audit_id AND s.thread_id=u.thread_id WHERE u.audit_id=a.id AND u.undone=0)
 WHEN a.op IN ('webhook_create','webhook_rotate') THEN EXISTS(SELECT 1 FROM webhooks w WHERE w.audit_id=a.id AND w.enabled=1) ELSE EXISTS(SELECT 1 FROM delegated_rules r WHERE r.audit_id=a.id AND undone=0) END reversible` +
        eligible +
        " ORDER BY a.at DESC,a.id DESC LIMIT 100",
    )
      .bind(user.id, box, user.id, user.id, box)
      .all()
  ).results;
}
export async function undoAction(
  env: Bindings,
  who: { user: User; credential?: Credential },
  box: string,
  id: string,
  dry: boolean,
) {
  const u = who.user.id;
  const entry = await env.DB.prepare("SELECT a.actor,a.op" + eligible + " AND a.id=?")
    .bind(u, box, u, u, box, id)
    .first<{ actor: string; op: string }>();
  if (!entry || (who.credential && entry.actor !== u))
    throw new Problem(404, "Audit entry unavailable");
  if (timerOperations.includes(entry.op)) return undoTimer(env, who, box, id, dry);
  if (entry.op === "message_triage")
    return undoTriage(
      env,
      { actor: entry.actor, user: u, credential: who.credential },
      box,
      id,
      dry,
    );
  if (entry.op === "webhook_create" || entry.op === "webhook_rotate") {
    const hook = await env.DB.prepare(
      "SELECT id FROM webhooks WHERE audit_id=? AND mailbox_id=? AND enabled=1",
    )
      .bind(id, box)
      .first<string>("id");
    if (!hook) throw new Problem(409, "Webhook has changed");
    return changeHook(env, who, box, "disable", { id: hook, expectedAudit: id }, dry);
  }
  const rule = await env.DB.prepare(
    "SELECT rule_id,revision,undone FROM delegated_rules WHERE audit_id=? AND mailbox_id=?",
  )
    .bind(id, box)
    .first<{ rule_id: string; revision: number; undone: number }>();
  if (!rule) throw new Problem(409, "This action cannot be undone");
  if (rule.undone) return { matched: 0, alreadyUndone: 1 };
  await ruleChange(
    env,
    who.user,
    box,
    rule.rule_id,
    {
      revision: rule.revision,
      ...(rule.revision === 1 ? { enabled: false } : { restore: rule.revision - 1 }),
      dry_run: dry,
    },
    { credential: who.credential, reverses: id },
  );
  return { matched: 1 };
}
