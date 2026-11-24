import { ulid } from "ulid";
import { address } from "../address";
import { Problem, type Bindings, type Principal } from "../env";
import { administrator, human } from "./access";

type Receipt = {
  id: string;
  target: string;
  at: string;
  transferred: number;
  cancelled: number;
  socket_cursor: string | null;
};

const soleBoxes = `SELECT count(*) FROM mailbox_members m WHERE m.user_id=t.id AND m.role='owner'
  AND NOT EXISTS (SELECT 1 FROM mailbox_members o JOIN users u ON u.id=o.user_id WHERE
    o.mailbox_id=m.mailbox_id AND o.user_id!=t.id AND o.role='owner' AND u.disabled_at IS NULL)`;
const pending = "SELECT count(*) FROM outbox WHERE actor=t.id AND state IN ('held','deferred')";

async function closeSessions(env: Bindings, receipt: Receipt) {
  // A signed-in administrator might have opened mailboxes without an explicit membership.
  const { results } = await env.DB.prepare(
    "SELECT id FROM mailboxes WHERE id>? ORDER BY id LIMIT 16",
  )
    .bind(receipt.socket_cursor)
    .all<{ id: string }>();
  await Promise.all(results.map((b) => env.LIVE.getByName(b.id).revoke(receipt.target)));
  const next = results.length === 16 ? results[15].id : null;
  await env.DB.prepare(
    "UPDATE offboard_receipts SET socket_cursor=? WHERE id=? AND socket_cursor=?",
  )
    .bind(next, receipt.id, receipt.socket_cursor)
    .run();
}

export async function sweepOffboarding(env: Bindings) {
  const receipt = await env.DB.prepare(
    "SELECT * FROM offboard_receipts WHERE socket_cursor IS NOT NULL ORDER BY at LIMIT 1",
  ).first<Receipt>();
  if (receipt) await closeSessions(env, receipt);
}

export async function offboard(env: Bindings, p: Principal, input: Record<string, unknown>) {
  administrator(p);
  const actor = human(p).id;
  const email = address(input.email).canonical;
  const selection = `FROM users t JOIN user_emails e ON e.user_id=t.id JOIN users a ON a.id=?
    WHERE e.email=? AND t.id!=a.id AND a.disabled_at IS NULL AND
    (a.role='owner' OR (a.role='admin' AND t.role!='owner'))`;
  const plan = await env.DB.prepare(
    `SELECT t.id,(${soleBoxes}) AS transferred,(${pending}) AS cancelled ${selection}`,
  )
    .bind(actor, email)
    .first<{ id: string; transferred: number; cancelled: number }>();
  if (!plan) throw new Problem(403, "Choose another user you can manage");
  if (input.dry_run === true) return plan;
  if (input.confirm !== email) throw new Problem(400, "Confirm the sign-in email");
  await env.DB.prepare(`INSERT INTO offboard_receipts(id,target,actor,at,transferred,cancelled,socket_cursor)
    SELECT ?,t.id,a.id,?,(${soleBoxes}),(${pending}),'' ${selection} AND t.disabled_at IS NULL
    ON CONFLICT(target) DO NOTHING`)
    .bind(ulid(), new Date().toISOString(), actor, email)
    .run();
  const receipt = await env.DB.prepare("SELECT * FROM offboard_receipts WHERE target=?")
    .bind(plan.id)
    .first<Receipt>();
  if (!receipt) throw new Problem(409, "This account no longer permits the change");
  if (receipt.socket_cursor !== null) await closeSessions(env, receipt);
  return {
    id: receipt.id,
    at: receipt.at,
    transferred: receipt.transferred,
    cancelled: receipt.cancelled,
  };
}
