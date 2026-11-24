import { Problem, type Bindings } from "../env";
import { mailboxAccess, type User } from "./access";
export async function explain(env: Bindings, user: User, box: string, id: string) {
  const selected =
    "SELECT m.id FROM messages m WHERE m.id=? AND m.mailbox_id IN (SELECT b.id " +
    mailboxAccess +
    " AND b.id=?)";
  const params = [id, user.id, box];
  const [base, runs, delivery] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      "SELECT m.id,a.reason,a.held FROM messages m LEFT JOIN mail_assessment a ON a.message_id=m.id WHERE m.id IN(" +
        selected +
        ")",
    ).bind(...params),
    env.DB.prepare(
      "SELECT r.rule_id,json_extract(v.document,'$.name') name,v.scope,r.revision,r.actions FROM rule_runs r JOIN rule_versions v ON v.rule_id=r.rule_id AND v.revision=r.revision WHERE r.message_id IN(" +
        selected +
        ") ORDER BY r.at,r.rule_id LIMIT 100",
    ).bind(...params),
    env.DB.prepare(
      "SELECT id,matched_address,kind,plus_tag,auth FROM deliveries WHERE message_id IN(" +
        selected +
        ") ORDER BY received_at,id LIMIT 100",
    ).bind(...params),
  ]);
  if (!base.results.length) throw new Problem(404, "Message unavailable");
  return {
    reason: base.results[0].reason || null,
    held: !!base.results[0].held,
    rules: runs.results,
    deliveries: delivery.results,
  };
}
