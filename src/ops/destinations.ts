import { verifyDestination, canVerifyDestination } from "./destination-verification";
import { ulid } from "ulid";
import { address } from "../address";
import { Problem, type Bindings, type Principal } from "../env";
import { human } from "./access";
export { owning } from "./mailbox-owner";
import { owning } from "./mailbox-owner";
export async function owner(env: Bindings, p: Principal, box: string) {
  const actor = human(p).id;
  if (!(await env.DB.prepare(owning).bind(actor, box).first()))
    throw new Problem(403, "Mailbox owner required");
  return actor;
}
export async function destinations(env: Bindings, p: Principal, box: string) {
  const actor = await owner(env, p, box);
  const rows = (
    await env.DB.prepare(
      `SELECT id,address,verified_at,disabled FROM egress_destinations WHERE mailbox_id IN (${owning}) ORDER BY address`,
    )
      .bind(actor, box)
      .all()
  ).results;
  return rows.map((r) => ({ ...r, provider_verification: canVerifyDestination(env) }));
}
export async function destinationChange(
  env: Bindings,
  p: Principal,
  box: string,
  input: Record<string, unknown>,
) {
  const actor = await owner(env, p, box);
  if (input.action === "verify") return verifyDestination(env, actor, box, input.id);
  if (input.action === "disable" && typeof input.id === "string") {
    await env.DB.prepare(
      `UPDATE egress_destinations SET disabled=1 WHERE id=? AND mailbox_id IN (${owning})`,
    )
      .bind(input.id, actor, box)
      .run();
    return { disabled: true };
  }
  const addr = await externalAddress(env, input.address);
  const row =
    await env.DB.prepare(`INSERT INTO egress_destinations(id,mailbox_id,owner,address) SELECT ?,id,?,? FROM mailboxes WHERE id IN (${owning})
    ON CONFLICT(mailbox_id,address) DO UPDATE SET owner=CASE WHEN disabled THEN excluded.owner ELSE owner END,verified_at=CASE WHEN disabled THEN NULL ELSE verified_at END,disabled=0 RETURNING id,verified_at`)
      .bind(ulid(), actor, addr, actor, box)
      .first();
  if (!row) throw new Problem(403, "Mailbox owner required");
  return row;
}

export async function externalAddress(env: Bindings, input: unknown) {
  const addr = address(input).canonical;
  const local = addr.split("@")[0].split("+")[0] + "@" + addr.split("@")[1];
  if (
    await env.DB.prepare("SELECT 1 FROM addresses WHERE canonical IN (?,?)")
      .bind(addr, local)
      .first()
  )
    throw new Problem(409, "Choose an address outside this instance");
  return addr;
}
