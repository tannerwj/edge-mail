import { timingSafeEqual, createHash } from "node:crypto";
import { ulid } from "ulid";
import { type Bindings, type Identity, type Principal, Problem } from "../env";

export const writable = `SELECT b.id FROM mailboxes b JOIN users u ON u.id=? AND u.disabled_at IS NULL WHERE b.id=? AND NOT EXISTS(SELECT 1 FROM person_boxes e WHERE e.box=b.id)
  AND (u.role IN ('owner','admin') OR EXISTS (SELECT 1 FROM mailbox_members mm WHERE mm.mailbox_id=b.id AND mm.user_id=u.id AND mm.role IN ('owner','editor')))`;

const digest = (v: string) => createHash("sha256").update(v).digest();
export type User = { kind: "user"; id: string; role: "owner" | "admin" | "member" };
export async function lookup(env: Bindings, who: Identity): Promise<User | null> {
  return env.DB.prepare(`SELECT 'user' AS kind,u.id,u.role FROM users u JOIN user_emails e ON e.user_id=u.id
    WHERE e.email=? AND u.disabled_at IS NULL`)
    .bind(who.email)
    .first<User>();
}
export async function setupOpen(env: Bindings) {
  return !(await env.DB.prepare("SELECT id FROM users LIMIT 1").first());
}
export async function bootstrap(env: Bindings, who: Identity, token: unknown) {
  if (!(await setupOpen(env))) throw new Problem(410, "Setup is closed");
  if (!env.SETUP_TOKEN) throw new Problem(503, "Setup token missing");

  if (typeof token !== "string" || !timingSafeEqual(digest(env.SETUP_TOKEN), digest(token)))
    throw new Problem(403, "Invalid setup token");
  const id = ulid();
  const [insert] = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users(id,role) SELECT ?,'owner' WHERE NOT EXISTS(SELECT 1 FROM users)",
    ).bind(id),
    env.DB.prepare("INSERT INTO user_emails SELECT ?,id FROM users WHERE id=?").bind(who.email, id),
  ]);
  if (!insert.meta.changes) throw new Problem(410, "Setup is closed");
}
export function human(p: Principal): User {
  if (p.kind !== "user") throw new Problem(403, "User access required");
  return p;
}
export function administrator(p: Principal) {
  if (human(p).role === "member") throw new Problem(403, "Administrator required");
}
export function ingestAccess(p: Principal, mailbox: string) {
  if (p.kind !== "ingest" || p.mailbox !== mailbox)
    throw new Problem(403, "Receipt outside job scope");
}
export const visible = `(u.role IN ('owner','admin') OR EXISTS (
  SELECT 1 FROM mailbox_members mm WHERE mm.mailbox_id=b.id AND mm.user_id=u.id))`;
export const mailboxAccess = `FROM mailboxes b JOIN users u ON u.id=? AND u.disabled_at IS NULL WHERE ${visible} AND NOT EXISTS(SELECT 1 FROM person_boxes erased WHERE erased.box=b.id)`;
export async function canManageDomain(env: Bindings, p: Principal, domain: string) {
  if (human(p).role !== "member") return;
  if (
    !(await env.DB.prepare("SELECT 1 FROM domain_admins WHERE user_id=? AND domain_id=?")
      .bind(human(p).id, domain)
      .first())
  )
    throw new Problem(403, "Domain administrator required");
}
