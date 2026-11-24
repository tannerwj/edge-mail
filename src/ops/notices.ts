import { type Bindings, Problem } from "../env";
import { owning } from "./destinations";
import type { User } from "./access";
export function egressNotice(env: Bindings, audit: string) {
  return env.DB.prepare(
    `INSERT INTO egress_alerts(audit_id,mailbox_id,at) SELECT a.id,a.mailbox_id,a.at FROM agent_audit a JOIN delegated_rules d ON d.audit_id=a.id WHERE a.id=? AND EXISTS(SELECT 1 FROM rule_versions v,json_each(v.document,'$.actions') action WHERE v.rule_id=d.rule_id AND v.revision IN (d.revision,d.revision-1) AND json_extract(action.value,'$.kind') IN ('auto_reply','forward','notify','agent_notify','webhook'))`,
  ).bind(audit);
}
export async function notices(env: Bindings, user: User) {
  return (
    await env.DB.prepare(
      "SELECT n.audit_id,n.mailbox_id,b.address,g.name FROM egress_alerts n JOIN mailboxes b ON b.id=n.mailbox_id JOIN agent_audit a ON a.id=n.audit_id JOIN agent_grants g ON g.id=a.grant_id WHERE n.ack_at IS NULL AND EXISTS(" +
        owning.replace("b.id=?", "b.id=n.mailbox_id") +
        ") ORDER BY n.at DESC LIMIT 30",
    )
      .bind(user.id)
      .all()
  ).results;
}
export async function acknowledge(env: Bindings, user: User, id: string) {
  const r = await env.DB.prepare(
    "UPDATE egress_alerts SET ack_by=coalesce(ack_by,?),ack_at=coalesce(ack_at,?) WHERE audit_id=? AND EXISTS(" +
      owning.replace("b.id=?", "b.id=egress_alerts.mailbox_id") +
      ")",
  )
    .bind(user.id, Date.now(), id, user.id)
    .run();
  if (!r.meta.changes) throw new Problem(404, "Notice unavailable");
  return { acknowledged: true };
}
