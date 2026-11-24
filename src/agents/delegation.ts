import { writesOn } from "../ops/budgets";
// These SQL expressions are fixed references from the claim and rule queries, never request data.
export function activeDelegation(grant: string, actor: string, box: string, audience: string) {
  return `EXISTS(WITH RECURSIVE parents AS(
 SELECT g.*,1 depth FROM agent_grants g WHERE g.id=${grant}
 UNION ALL SELECT g.*,p.depth+1 FROM parents p JOIN agent_grants g ON g.id=p.parent WHERE p.depth<9
 ) SELECT 1 WHERE ${writesOn} AND EXISTS(SELECT 1 FROM parents WHERE parent IS NULL AND depth<=8)
 AND NOT EXISTS(SELECT 1 FROM parents p WHERE p.revoked IS NOT NULL OR p.expires<=unixepoch('subsec')*1000 OR p.actor!=${actor} OR p.audience!=${audience}
 OR NOT EXISTS(SELECT 1 FROM json_each(p.scopes) WHERE value IN ('admin','mail.write'))
 OR (p.boxes IS NOT NULL AND NOT EXISTS(SELECT 1 FROM json_each(p.boxes) WHERE value=${box}))))`;
}
export const jobAllowed = activeDelegation(
  "json_extract(outbox.letter,'$.agent_grant')",
  "outbox.actor",
  "outbox.mailbox_id",
  "json_extract(outbox.letter,'$.agent_origin')",
);
export const ruleAllowed = `NOT EXISTS(SELECT 1 FROM delegated_rules d WHERE d.rule_id=v.rule_id AND d.revision=v.revision AND NOT ${activeDelegation("d.grant_id", "d.actor", "d.mailbox_id", "d.audience")})`;
