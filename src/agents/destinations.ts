import { ulid } from "ulid";
import { Problem, type Bindings } from "../env";
import { owner, owning, externalAddress } from "../ops/destinations";
import { changed } from "../live";
import { wakePush } from "../ops/push";
import { guard, liveWrite } from "./audit";
import type { Credential } from "./grants";
import { sendDecision } from "./policies";
import { finishReview, pendingReview, propose, requireEgressApproval } from "./review-request";
export async function addDestination(
  env: Bindings,
  c: Credential,
  box: string,
  input: unknown,
  dry: boolean,
  review?: string,
) {
  const actor = await owner(env, c.user, box);
  const addr = await externalAddress(env, input);
  const held = await sendDecision(env, c.grant, box, [addr]);
  if (!review && (held || (await requireEgressApproval(env, c))))
    return propose(
      env,
      c,
      box,
      {
        kind: "destination",
        args: { address: addr },
        description: "Register a forwarding destination for recipient verification",
      },
      dry,
    );
  if (dry) return { would_register: true, address: addr };
  const audit = ulid(),
    now = Date.now();
  const add = env.DB.prepare(
    "INSERT INTO egress_destinations(id,mailbox_id,owner,address) SELECT ?,?,?,? WHERE EXISTS(" +
      owning +
      ") AND EXISTS(" +
      liveWrite +
      ") AND (SELECT count(*) FROM egress_destinations WHERE mailbox_id=? AND disabled=0)<200" +
      (review ? " AND " + pendingReview : "") +
      " ON CONFLICT(mailbox_id,address) DO UPDATE SET owner=CASE WHEN disabled THEN excluded.owner ELSE owner END,verified_at=CASE WHEN disabled THEN NULL ELSE verified_at END,disabled=0 RETURNING id,verified_at",
  ).bind(
    ulid(),
    box,
    actor,
    addr,
    actor,
    box,
    ...guard(c, box),
    box,
    ...(review ? [review, actor, c.grant, box] : []),
  );
  const [write] = await env.DB.batch([
    add,
    env.DB.prepare(
      "INSERT INTO agent_audit SELECT ?,?,?,?,'egress_destination_add',?,1 WHERE changes()=1",
    ).bind(audit, c.grant, actor, box, now),
    env.DB.prepare(
      "INSERT INTO egress_alerts(audit_id,mailbox_id,at) SELECT id,mailbox_id,at FROM agent_audit WHERE id=?",
    ).bind(audit),
    ...finishReview(env, review, audit),
  ]);
  if (!write.results.length)
    throw new Problem(409, "Destination limit reached or permission changed");
  await changed(env, box);
  await wakePush(env, audit);
  return write.results[0];
}
