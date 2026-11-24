import { visibleInbox } from "./thread-views";
import { defaultSender } from "./identities";
import { ulid } from "ulid";
import { address, domainName } from "../address";
import { Problem, requireValue, type Bindings, type Principal } from "../env";
import { administrator, canManageDomain, human, mailboxAccess } from "./access";

export async function workspace(env: Bindings, p: Principal) {
  const user = human(p);
  const boxes = await env.DB.prepare(
    `SELECT b.id,b.address,b.display_name,b.domain_id,
      (SELECT count(*) FROM messages m LEFT JOIN thread_members t ON t.message_id=m.id AND t.mailbox_id=m.mailbox_id WHERE m.mailbox_id=b.id AND m.folder='inbox' AND m.is_read=0 AND ${visibleInbox}) AS unread,
      (u.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM mailbox_members m WHERE m.user_id=u.id AND m.mailbox_id=b.id AND m.role IN ('editor','owner'))) AS can_edit,
      (u.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM mailbox_members m WHERE m.user_id=u.id AND m.mailbox_id=b.id AND m.role='owner')) AS can_forward
      ${mailboxAccess} ORDER BY b.address`,
  )
    .bind(user.id)
    .all<{ id: string; address: string; can_edit: number }>();
  const domains =
    await env.DB.prepare(`SELECT d.id,d.name FROM domains d WHERE ? IN ('admin','owner') OR EXISTS
    (SELECT 1 FROM domain_admins a WHERE a.user_id=? AND a.domain_id=d.id) ORDER BY d.name`)
      .bind(user.role, user.id)
      .all();
  const managed =
    await env.DB.prepare(`SELECT b.id,b.display_name,b.address,b.domain_id FROM mailboxes b
    WHERE (? IN ('admin','owner') OR EXISTS (SELECT 1 FROM domain_admins a WHERE a.user_id=? AND a.domain_id=b.domain_id)
    OR EXISTS (SELECT 1 FROM mailbox_members mm WHERE mm.mailbox_id=b.id AND mm.user_id=? AND mm.role='owner')) AND NOT EXISTS(SELECT 1 FROM person_boxes erased WHERE erased.box=b.id)
    ORDER BY b.address`)
      .bind(user.role, user.id, user.id)
      .all();
  const capture = env.SEND_MODE === "capture" || env.PROBE_MODE === "capture";
  const mailboxes = boxes.results.map((b) => ({
    ...b,
    capture,
    send_from: b.can_edit
      ? capture
        ? b.address
        : env.SEND_MODE === "cloudflare"
          ? (defaultSender(env, b.address) ?? null)
          : null
      : null,
  }));
  return { user, mailboxes, domains: domains.results, managed: managed.results };
}
export async function addDomain(env: Bindings, p: Principal, name: unknown) {
  administrator(p);
  const id = ulid();
  await env.DB.prepare("INSERT INTO domains VALUES (?,?,?)")
    .bind(id, domainName(name), human(p).id)
    .run();
  return { id };
}
export async function addMailbox(env: Bindings, p: Principal, input: Record<string, unknown>) {
  const recipient = address(input.address);
  const domain = await env.DB.prepare("SELECT id FROM domains WHERE name=?")
    .bind(recipient.host)
    .first<string>("id");
  if (!domain) throw new Problem(400, "Add the receiving domain first");
  await canManageDomain(env, p, domain);
  const id = ulid(),
    owner = human(p).id;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO mailboxes VALUES (?,?,?,?,?)").bind(
      id,
      domain,
      recipient.original,
      requireValue(input.name, 120),
      owner,
    ),
    env.DB.prepare("INSERT INTO mailbox_members VALUES (?,?,'owner')").bind(id, owner),
    env.DB.prepare("INSERT INTO addresses VALUES (?,?,?,'primary')").bind(
      recipient.canonical,
      recipient.original,
      id,
    ),
  ]);
  return { id };
}
export async function addAlias(env: Bindings, p: Principal, mailbox: string, input: unknown) {
  const recipient = address(input);
  const domain = await env.DB.prepare(
    "SELECT d.id FROM mailboxes b JOIN domains d ON d.id=b.domain_id WHERE b.id=? AND d.name=?",
  )
    .bind(mailbox, recipient.host)
    .first<string>("id");
  if (!domain) throw new Problem(400, "Alias must use the mailbox domain");
  await canManageDomain(env, p, domain);
  await env.DB.prepare("INSERT INTO addresses VALUES (?,?,?,'alias')")
    .bind(recipient.canonical, recipient.original, mailbox)
    .run();
  return { address: recipient.original };
}
export async function addUser(env: Bindings, p: Principal, input: Record<string, unknown>) {
  administrator(p);
  const email = address(input.email).canonical;
  const role = input.role ?? "member";
  if (role !== "member" && role !== "admin" && role !== "owner")
    throw new Problem(400, "Invalid instance role");
  if (role !== "member" && human(p).role !== "owner")
    throw new Problem(403, "Instance owner required");
  const id = ulid();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users(id,role) VALUES (?,?)").bind(id, role),
    env.DB.prepare("INSERT INTO user_emails VALUES (?,?)").bind(email, id),
  ]);
  return { id };
}
export async function grant(
  env: Bindings,
  p: Principal,
  mailbox: string,
  input: Record<string, unknown>,
) {
  const domain = await env.DB.prepare("SELECT domain_id FROM mailboxes WHERE id=?")
    .bind(mailbox)
    .first<string>("domain_id");
  if (!domain) throw new Problem(404, "Mailbox unavailable");
  const user = human(p);
  const owns = await env.DB.prepare(
    "SELECT 1 FROM mailbox_members WHERE mailbox_id=? AND user_id=? AND role='owner'",
  )
    .bind(mailbox, user.id)
    .first();
  if (!owns) await canManageDomain(env, p, domain);
  const role = requireValue(input.role);
  if (!["reader", "editor", "owner"].includes(role)) throw new Problem(400, "Invalid role");
  const target = await env.DB.prepare(
    "SELECT user_id FROM user_emails JOIN users ON users.id=user_id WHERE email=? AND disabled_at IS NULL",
  )
    .bind(address(input.email).canonical)
    .first<string>("user_id");
  if (!target) throw new Problem(404, "Add the user first");
  const result =
    await env.DB.prepare(`INSERT INTO mailbox_members SELECT ?,id,? FROM users WHERE id=? AND disabled_at IS NULL ON CONFLICT(mailbox_id,user_id) DO UPDATE SET role=excluded.role
    WHERE mailbox_members.role!='owner' OR excluded.role='owner' OR EXISTS
    (SELECT 1 FROM mailbox_members JOIN users ON users.id=user_id WHERE disabled_at IS NULL AND mailbox_id=? AND user_id!=? AND mailbox_members.role='owner')`)
      .bind(mailbox, role, target, mailbox, target)
      .run();
  if (!result.meta.changes) throw new Problem(409, "Mailbox requires an owner");
  return { role };
}

export async function grantDomain(env: Bindings, p: Principal, domain: string, email: unknown) {
  administrator(p);
  const member = await env.DB.prepare(
    "SELECT user_id FROM user_emails JOIN users ON users.id=user_id WHERE email=? AND disabled_at IS NULL",
  )
    .bind(address(email).canonical)
    .first<string>("user_id");
  if (!member) throw new Problem(404, "Add the user first");
  if (!(await env.DB.prepare("SELECT 1 FROM domains WHERE id=?").bind(domain).first()))
    throw new Problem(404, "Domain unavailable");
  await env.DB.prepare(
    "INSERT INTO domain_admins SELECT ?,id FROM users WHERE id=? AND disabled_at IS NULL ON CONFLICT DO NOTHING",
  )
    .bind(domain, member)
    .run();
  return { role: "domain_admin" };
}
