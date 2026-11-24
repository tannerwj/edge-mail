import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { type Bindings, Problem, requireValue } from "../env";
import { type User, mailboxAccess, canManageDomain } from "./access";
import { owning, owner } from "./destinations";
import { guard, liveWrite } from "../agents/audit";
import type { Credential } from "../agents/grants";
type Args = Record<string, unknown>;
export async function addressSettings(env: Bindings, user: User, box: string) {
  await owner(env, user, box);
  return {
    addresses: (
      await env.DB.prepare(
        "SELECT canonical,label,expires,disabled,reason,first_sender,first_at FROM temporary_addresses WHERE mailbox_id IN(" +
          owning +
          ") ORDER BY created DESC LIMIT 100",
      )
        .bind(user.id, box)
        .all()
    ).results,
    label_plus:
      (await env.DB.prepare("SELECT label_plus FROM receipt_preferences WHERE mailbox_id=?")
        .bind(box)
        .first<number>("label_plus")) ?? 1,
  };
}
function duration(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 8760)
    throw new Problem(400, "Choose a lifetime between one hour and one year");
  return Date.now() + value * 3600000;
}
export async function disposable(
  env: Bindings,
  user: User,
  box: string,
  a: Args,
  c?: Credential,
  dry = false,
) {
  await owner(env, user, box);
  const permission = owning + (c ? " AND EXISTS(" + liveWrite + ")" : ""),
    scope = [user.id, box, ...(c ? guard(c, box) : [])];
  let statement: D1PreparedStatement, canonical: string;
  if (a.action === "disable") {
    canonical = requireValue(a.address);
    statement = env.DB.prepare(
      "UPDATE temporary_addresses SET disabled=1,reason='revoked' WHERE canonical=? AND mailbox_id IN(" +
        permission +
        ")",
    ).bind(canonical, ...scope);
  } else if (a.action === "create") {
    const label = requireValue(a.label, 40);
    const expires = duration(a.ttl_hours);
    const prefix =
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "mail";
    const domain = await env.DB.prepare(
      "SELECT d.name FROM domains d JOIN mailboxes b ON b.domain_id=d.id WHERE b.id IN(" +
        permission +
        ")",
    )
      .bind(...scope)
      .first<string>("name");
    if (!domain) throw new Problem(403, "Mailbox owner required");
    canonical = prefix + "-" + randomBytes(8).toString("hex") + "@" + domain;
    statement = env.DB.prepare(
      "INSERT INTO temporary_addresses(canonical,mailbox_id,label,created,expires) SELECT ?,?,?,?,? WHERE EXISTS(" +
        permission +
        ") AND (SELECT count(*) FROM temporary_addresses WHERE mailbox_id=? AND disabled=0 AND (expires IS NULL OR expires>?))<200",
    ).bind(canonical, box, label, Date.now(), expires, ...scope, box, Date.now());
  } else throw new Problem(400, "Choose create or disable");
  if (dry) return { would_apply: a.action };
  const audit = ulid(),
    [result] = await env.DB.batch([
      statement,
      ...(c
        ? [
            env.DB.prepare("INSERT INTO agent_audit SELECT ?,?,?,?,?,?,1 WHERE changes()>0").bind(
              audit,
              c.grant,
              user.id,
              box,
              "address_" + a.action + "_disposable",
              Date.now(),
            ),
          ]
        : []),
    ]);
  if (!result.meta.changes)
    throw new Problem(409, "Address unavailable or the active address limit was reached");
  return { address: canonical, ...(c ? { audit_id: audit } : {}) };
}
export async function plusPreference(env: Bindings, user: User, box: string, on: unknown) {
  if (typeof on !== "boolean") throw new Problem(400, "Choose whether to label tagged mail");
  const r = await env.DB.prepare(
    "INSERT INTO receipt_preferences SELECT id,? FROM mailboxes WHERE id IN(" +
      owning +
      ") ON CONFLICT(mailbox_id) DO UPDATE SET label_plus=excluded.label_plus",
  )
    .bind(Number(on), user.id, box)
    .run();
  if (!r.meta.changes) throw new Problem(403, "Mailbox owner required");
  return { saved: true };
}
export async function unknownRecipients(env: Bindings, user: User, domain: string, a?: Args) {
  await canManageDomain(env, user, domain);
  if (!a)
    return (
      (await env.DB.prepare(
        "SELECT mode,mailbox_id FROM unknown_recipient_policy WHERE domain_id=?",
      )
        .bind(domain)
        .first()) ?? { mode: "reject", mailbox_id: null }
    );
  const mode = a.mode;
  if (!["reject", "drop", "deliver"].includes(String(mode)))
    throw new Problem(400, "Choose an unknown-recipient policy");
  const box = mode === "deliver" ? requireValue(a.mailbox, 26) : null;
  if (
    box &&
    !(await env.DB.prepare("SELECT b.id " + mailboxAccess + " AND b.id=? AND b.domain_id=?")
      .bind(user.id, box, domain)
      .first())
  )
    throw new Problem(403, "Choose a mailbox you can access in this domain");
  const r = await env.DB.prepare(
    "INSERT INTO unknown_recipient_policy SELECT d.id,?,? FROM domains d JOIN users u ON u.id=? AND u.disabled_at IS NULL WHERE d.id=? AND (u.role IN('owner','admin') OR EXISTS(SELECT 1 FROM domain_admins m WHERE m.user_id=u.id AND m.domain_id=d.id)) ON CONFLICT(domain_id) DO UPDATE SET mode=excluded.mode,mailbox_id=excluded.mailbox_id",
  )
    .bind(mode, box, user.id, domain)
    .run();
  if (!r.meta.changes) throw new Problem(403, "Domain administrator required");
  return { saved: true };
}
