import { type Bindings, Problem } from "../env";
import { address } from "../address";
import { owner } from "./destinations";
import { mailboxAccess, type User } from "./access";
type Mapping = { from: string; mailbox: string };
export function mappings(
  env: Pick<Bindings, "SEND_IDENTITIES" | "SEND_FROM" | "SEND_MAILBOX">,
): Mapping[] {
  const primary =
    env.SEND_FROM && env.SEND_MAILBOX ? [{ from: env.SEND_FROM, mailbox: env.SEND_MAILBOX }] : [];
  if (!env.SEND_IDENTITIES) return primary;
  const list: unknown = JSON.parse(env.SEND_IDENTITIES);
  if (!Array.isArray(list) || list.length > 64)
    throw new Problem(503, "Invalid sending identities");
  return [
    ...primary,
    ...list.map((v) => ({
      from: address(v.from).canonical,
      mailbox: address(v.mailbox).canonical,
    })),
  ];
}
export const defaultSender = (env: Bindings, mailbox: string) =>
  mappings(env).find((m) => m.mailbox === mailbox.toLowerCase())?.from;
export const captureMode = (env: Bindings) =>
  env.SEND_MODE === "capture" || env.PROBE_MODE === "capture";
export async function senders(env: Bindings, box: string, mailbox: string) {
  const available = captureMode(env)
    ? (
        await env.DB.prepare(
          "SELECT canonical FROM addresses WHERE mailbox_id=? ORDER BY kind='primary' DESC,canonical",
        )
          .bind(box)
          .all<{ canonical: string }>()
      ).results.map((v) => v.canonical)
    : mappings(env)
        .filter((m) => m.mailbox === mailbox.toLowerCase())
        .map((m) => m.from);
  const rows = (
    await env.DB.prepare("SELECT address,signature FROM identity_signatures WHERE mailbox_id=?")
      .bind(box)
      .all<{ address: string; signature: string }>()
  ).results;
  const signatures = new Map(rows.map((r) => [r.address, r.signature]));
  return [...new Set(available)].map((from) => ({ from, signature: signatures.get(from) || "" }));
}
export async function chooseIdentity(
  env: Bindings,
  box: string,
  mailbox: string,
  requested?: string,
) {
  const options = await senders(env, box, mailbox);
  const found = requested ? options.find((o) => o.from === requested) : options[0];
  if (!found) throw new Problem(403, "Mailbox has no matching sending identity");
  return found;
}
export async function saveSignature(
  env: Bindings,
  user: User,
  box: string,
  a: Record<string, unknown>,
) {
  await owner(env, user, box);
  const mailbox = await env.DB.prepare("SELECT address FROM mailboxes WHERE id=?")
    .bind(box)
    .first<string>("address");
  if (
    !mailbox ||
    typeof a.from !== "string" ||
    typeof a.signature !== "string" ||
    a.signature.length > 4096
  )
    throw new Problem(400, "Choose an identity and a signature up to 4,096 characters");
  const choice = await chooseIdentity(env, box, mailbox, a.from);
  await env.DB.prepare(
    "INSERT INTO identity_signatures VALUES(?,?,?) ON CONFLICT(mailbox_id,address) DO UPDATE SET signature=excluded.signature",
  )
    .bind(box, choice.from, a.signature)
    .run();
  return { from: choice.from, signature: a.signature };
}

export async function mailboxIdentities(env: Bindings, user: User, box: string) {
  const row = await env.DB.prepare("SELECT b.address " + mailboxAccess + " AND b.id=?")
    .bind(user.id, box)
    .first<string>("address");
  if (!row) throw new Problem(404, "Mailbox unavailable");
  return senders(env, box, row);
}
