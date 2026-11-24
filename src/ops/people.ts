import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { address } from "../address";
import { type Bindings, Problem, requireValue } from "../env";
import { administrator, type User } from "./access";
import { mailboxIdentities } from "./identities";
import { saveDraft } from "./drafts";
import { submitDraft } from "./outbox";
export async function people(env: Bindings, user: User) {
  administrator(user);
  return (
    await env.DB.prepare(
      "SELECT u.id,u.role,u.disabled_at,json_group_array(e.email) emails FROM users u JOIN user_emails e ON e.user_id=u.id GROUP BY u.id ORDER BY min(e.email) LIMIT 300",
    ).all()
  ).results;
}
export async function addLogin(env: Bindings, user: User, data: Record<string, unknown>) {
  administrator(user);
  const email = address(data.email).canonical,
    target = String(data.id);
  const row = await env.DB.prepare(
    "INSERT INTO user_emails SELECT ?,u.id FROM users u JOIN users a ON a.id=? AND a.disabled_at IS NULL WHERE u.id=? AND u.disabled_at IS NULL AND (a.role='owner' OR (a.role='admin' AND u.role='member')) ON CONFLICT(email) DO UPDATE SET user_id=excluded.user_id WHERE user_emails.user_id=excluded.user_id RETURNING email",
  )
    .bind(email, user.id, target)
    .first();
  if (!row) throw new Problem(409, "Cannot assign this sign-in address to the selected user");
  return { email };
}
async function inviteMail(
  env: Bindings,
  user: User,
  person: { id: string; email: string },
  box: string,
  origin: string,
) {
  const id = createHash("sha256")
    .update(JSON.stringify(["invite", user.id, person.id, box, person.email]))
    .digest("hex")
    .slice(0, 26)
    .toUpperCase();
  const existing = await env.DB.prepare(
    "SELECT state FROM outbox WHERE id=? AND mailbox_id=? AND actor=?",
  )
    .bind(id, box, user.id)
    .first();
  if (existing) return { id, ...existing };
  const content = {
    to: person.email,
    cc: "",
    bcc: "",
    subject: "Your Edge Mail invitation",
    body:
      "You have been invited to a shared mailbox.\n\nOpen " +
      origin +
      "/mailboxes/" +
      box +
      "/inbox and sign in with " +
      person.email +
      ". Your administrator manages sign-in with Cloudflare Access.",
  };
  await saveDraft(env, user, box, undefined, { id, content });
  return submitDraft(env, user, box, id, { revision: 1 });
}
export async function invite(
  env: Bindings,
  user: User,
  data: Record<string, unknown>,
  origin: string,
) {
  administrator(user);
  const email = address(data.email).canonical,
    role = requireValue(data.role ?? "member", 12),
    box = data.mailbox ? requireValue(data.mailbox, 26) : "";
  if (!["member", "admin", "owner"].includes(role) || (role !== "member" && user.role !== "owner"))
    throw new Problem(403, "Choose an available instance role");
  const access = requireValue(data.permission ?? "reader", 12);
  if (!["reader", "editor", "owner"].includes(access))
    throw new Problem(400, "Choose a mailbox role");
  if (box && !(await env.DB.prepare("SELECT 1 FROM mailboxes WHERE id=?").bind(box).first()))
    throw new Problem(404, "Mailbox unavailable");
  if (data.send === true && (!box || !(await mailboxIdentities(env, user, box)).length))
    throw new Problem(400, "Choose a mailbox with an authorized From address");
  const id = ulid();
  const batch = [
    env.DB.prepare(
      "INSERT INTO users(id,role) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM user_emails WHERE email=?)",
    ).bind(id, role, email),
    env.DB.prepare("INSERT OR IGNORE INTO user_emails SELECT ?,id FROM users WHERE id=?").bind(
      email,
      id,
    ),
  ];
  const eligible =
    "SELECT u.id FROM users u JOIN user_emails e ON e.user_id=u.id WHERE e.email=? AND u.role=? AND u.disabled_at IS NULL";
  if (box)
    batch.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO mailbox_members SELECT ?,id,? FROM (" + eligible + ")",
      ).bind(box, access, email, role),
    );
  batch.push(env.DB.prepare(eligible).bind(email, role));
  const rows = await env.DB.batch<{ id: string }>(batch);
  const person = rows.at(-1)?.results[0];
  if (!person)
    throw new Problem(409, "This account already exists with a different role or is disabled");
  const invitation =
    data.send === true ? await inviteMail(env, user, { ...person, email }, box, origin) : null;
  return { id: person.id, invitation };
}
