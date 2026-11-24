import { ulid } from "ulid";
import { createHash } from "node:crypto";
import { type Bindings, Problem } from "../env";
import { seal } from "../instance-key";
import { liveWrite, guard } from "./audit";
import type { Credential } from "./grants";
import { wakePush } from "../ops/push";

export const pendingReview =
  "EXISTS(SELECT 1 FROM agent_reviews WHERE id=? AND state='pending' AND actor=? AND grant_id=? AND mailbox_id=?)";
export function finishReview(env: Bindings, id: string | undefined, audit: string) {
  return id
    ? [
        env.DB.prepare(
          "UPDATE agent_reviews SET state='approved',request=NULL,decided_by=actor,decided=unixepoch()*1000 WHERE id=? AND state='pending' AND EXISTS(SELECT 1 FROM agent_audit a WHERE a.id=? AND a.grant_id=agent_reviews.grant_id)",
        ).bind(id, audit),
      ]
    : [];
}
export async function requireEgressApproval(env: Bindings, c: Credential) {
  return !!(await env.DB.prepare(
    "SELECT 1 FROM grant_lineage l JOIN grant_policies p ON p.grant_id=l.ancestor WHERE l.leaf=? AND p.review_egress=1 LIMIT 1",
  )
    .bind(c.grant)
    .first());
}
export async function propose(
  env: Bindings,
  c: Credential,
  box: string,
  proposal: { kind: string; args: object; description: string },
  dry: boolean,
) {
  const { kind, args, description } = proposal;
  if (dry) return { would_hold: true, reason: "human_approval" };
  const id = ulid(),
    request = JSON.stringify(args);
  const key = createHash("sha256")
    .update(JSON.stringify([box, c.grant, kind, request]))
    .digest("hex");
  const sealed = await seal(env, "approval:" + id, request);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO agent_reviews(id,mailbox_id,grant_id,actor,kind,reason,request,created,request_key) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(" +
      liveWrite +
      ")",
  )
    .bind(
      id,
      box,
      c.grant,
      c.user.id,
      kind,
      description,
      JSON.stringify(sealed),
      Date.now(),
      key,
      ...guard(c, box),
    )
    .run();
  const row = await env.DB.prepare(
    "SELECT id,state FROM agent_reviews WHERE request_key=? AND grant_id=?",
  )
    .bind(key, c.grant)
    .first<{ id: string; state: string }>();
  if (!row) throw new Problem(403, "Grant expired");
  if (row.id === id) await wakePush(env, id);
  return { approval_id: row.id, state: row.state };
}
