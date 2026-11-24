import * as z from "zod/mini";
import { address } from "../address";
import { type Bindings, Problem } from "../env";
export const policySchema = z.object({
  mode: z.optional(z.enum(["allow", "drafts_only", "hold_all", "hold_new_recipients"])),
  daily_cap: z.optional(z.nullable(z.number().check(z.int(), z.minimum(1), z.maximum(10000)))),
  recipients: z.optional(z.nullable(z.array(z.string()).check(z.minLength(1), z.maxLength(100)))),
  review_egress: z.optional(z.boolean()),
});
type Policy = z.infer<typeof policySchema>;
export function storePolicy(env: Bindings, id: string, p?: Policy) {
  if (!p) return [];
  const list = p.recipients?.map((value) => address(value).canonical);
  return [
    env.DB.prepare("INSERT INTO grant_policies VALUES(?,?,?,?,?)").bind(
      id,
      p.mode ?? "allow",
      p.daily_cap ?? null,
      list ? JSON.stringify([...new Set(list)]) : null,
      Number(p.review_egress === true),
    ),
  ];
}
const policies =
  "FROM grant_lineage l JOIN grant_policies p ON p.grant_id=l.ancestor WHERE l.leaf=?";
export async function sendDecision(env: Bindings, grant: string, box: string, to: string[]) {
  const json = JSON.stringify(to);
  const row = await env.DB.prepare(
    "SELECT EXISTS(SELECT 1 " +
      policies +
      " AND send_mode='drafts_only') drafts,EXISTS(SELECT 1 " +
      policies +
      " AND recipients IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(?) r WHERE r.value NOT IN (SELECT value FROM json_each(p.recipients)))) denied,EXISTS(SELECT 1 " +
      policies +
      " AND (send_mode='hold_all' OR (send_mode='hold_new_recipients' AND EXISTS(SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(SELECT 1 FROM human_recipients h WHERE h.mailbox_id=? AND h.address=r.value))))) review",
  )
    .bind(grant, grant, json, grant, json, box)
    .first<{ drafts: number; denied: number; review: number }>();
  if (!row || row.drafts) throw new Problem(403, "This grant may save drafts only");
  if (row.denied) throw new Problem(403, "A recipient is outside this grant’s allowlist");
  return row.review ? "human_approval" : null;
}
export const overGrantCap =
  "EXISTS(SELECT 1 FROM grant_lineage l JOIN grant_policies p ON p.grant_id=l.ancestor WHERE l.leaf=json_extract(outbox.letter,'$.agent_grant') AND p.daily_cap IS NOT NULL AND (SELECT coalesce(sum(s.units),0) FROM grant_spend s WHERE s.grant_id=p.grant_id AND s.day=date('now') AND s.item!=outbox.id)+outbox.units>p.daily_cap)";

export async function restrictedRelay(env: Bindings, grant: string) {
  return !!(await env.DB.prepare(
    "SELECT 1 " +
      policies +
      " AND (p.send_mode!='allow' OR p.daily_cap IS NOT NULL OR p.recipients IS NOT NULL) LIMIT 1",
  )
    .bind(grant)
    .first());
}
