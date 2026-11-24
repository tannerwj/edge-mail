import { ulid } from "ulid";
import { Problem, type Bindings } from "../env";
import { canManageDomain, type User } from "./access";
const standards = [
  ["postmaster", "Postmaster"],
  ["abuse", "Abuse reports"],
  ["dmarc", "DMARC aggregate reports"],
] as const;
export async function standardMailboxes(env: Bindings, user: User, domain: string) {
  await canManageDomain(env, user, domain);
  const zone = await env.DB.prepare("SELECT name FROM domains WHERE id=?")
    .bind(domain)
    .first<string>("name");
  if (!zone) throw new Problem(404, "Receiving domain unavailable");
  const statements = [],
    addresses = [],
    ids = [];
  for (const [local, name] of standards) {
    const mailbox = ulid(),
      address = local + "@" + zone;
    addresses.push(address);
    ids.push(mailbox);
    statements.push(
      env.DB.prepare(
        "INSERT INTO mailboxes SELECT ?,?,?,?,u.id FROM users u WHERE u.id=? AND u.disabled_at IS NULL AND (u.role IN ('admin','owner') OR EXISTS(SELECT 1 FROM domain_admins a WHERE a.user_id=u.id AND a.domain_id=?)) AND NOT EXISTS(SELECT 1 FROM addresses WHERE canonical=?) AND NOT EXISTS(SELECT 1 FROM temporary_addresses WHERE canonical=?) ON CONFLICT(address) DO NOTHING",
      ).bind(mailbox, domain, address, name, user.id, domain, address, address),
      env.DB.prepare(
        "INSERT INTO mailbox_members SELECT id,?,'owner' FROM mailboxes WHERE id=?",
      ).bind(user.id, mailbox),
      env.DB.prepare(
        "INSERT INTO addresses SELECT ?,?,id,'primary' FROM mailboxes WHERE id=?",
      ).bind(address, address, mailbox),
    );
    if (local === "dmarc")
      statements.push(
        env.DB.prepare("INSERT INTO dmarc_mailboxes SELECT id,1 FROM mailboxes WHERE id=?").bind(
          mailbox,
        ),
      );
  }
  statements.push(
    env.DB.prepare(
      "SELECT count(*) created FROM mailboxes WHERE id IN(SELECT value FROM json_each(?))",
    ).bind(JSON.stringify(ids)),
  );
  const rows = await env.DB.batch<{ created: number }>(statements);
  return { addresses, created: rows.at(-1)?.results[0]?.created ?? 0 };
}
