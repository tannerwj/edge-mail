import { resolveReply } from "./reply-through";
import { address } from "../address";
type Route = { mailbox_id: string; address: string; kind: string };
type Routed = Route & { tag: string | null };
type EmailDatabase = { DB: D1Database };
const findAddress = "SELECT mailbox_id,address,kind FROM addresses WHERE canonical=?";
async function temporary(env: EmailDatabase, canonical: string) {
  const now = Date.now(),
    minute = Math.floor(now / 60000);
  // Claim the attempt before admitting mail. Concurrent isolates share the same one-minute counter.
  const r = await env.DB.prepare(
    "UPDATE temporary_addresses SET attempts=CASE WHEN window=?1 THEN attempts+1 ELSE 1 END,window=?1,disabled=CASE WHEN window=?1 AND attempts>=60 THEN 1 ELSE 0 END,reason=CASE WHEN window=?1 AND attempts>=60 THEN 'flood' END WHERE canonical=?2 AND disabled=0 AND (expires IS NULL OR expires>?3) RETURNING mailbox_id,canonical address,disabled",
  )
    .bind(minute, canonical, now)
    .first<{ mailbox_id: string; address: string; disabled: number }>();
  if (r)
    return r.disabled
      ? null
      : { mailbox_id: r.mailbox_id, address: r.address, kind: "disposable", tag: null };
  if (
    await env.DB.prepare("SELECT 1 FROM temporary_addresses WHERE canonical=?")
      .bind(canonical)
      .first()
  )
    return null;
  return undefined;
}
export async function resolveRecipient(
  env: EmailDatabase,
  to: string,
): Promise<Routed | "drop" | null> {
  const { canonical, local, host } = address(to),
    query = env.DB.prepare(findAddress);
  const plus = local.indexOf("+");
  if (
    plus > 0 &&
    local
      .slice(plus + 1)
      .toLowerCase()
      .startsWith("emr-")
  )
    return resolveReply(env, canonical);
  const exact = await query.bind(canonical).first<Route>();
  if (exact) return { ...exact, tag: null };
  if (plus > 0) {
    const canonicalBase = address(local.slice(0, plus) + "@" + host).canonical;
    const base = await query.bind(canonicalBase).first<Route>();
    if (base) return { ...base, kind: "plus", tag: local.slice(plus + 1) };
    const disposable = await temporary(env, canonicalBase);
    if (disposable !== undefined) return disposable;
  }
  const special = await temporary(env, canonical);
  if (special !== undefined) return special;
  const policy = await env.DB.prepare(
    "SELECT p.mode,p.mailbox_id,b.address FROM unknown_recipient_policy p JOIN domains d ON d.id=p.domain_id LEFT JOIN mailboxes b ON b.id=p.mailbox_id AND b.domain_id=d.id WHERE d.name=?",
  )
    .bind(host)
    .first<{ mode: string; mailbox_id: string; address: string }>();
  if (policy?.mode === "drop") return "drop";
  return policy?.mode === "deliver" && policy.address
    ? { mailbox_id: policy.mailbox_id, address: policy.address, kind: "catch-all", tag: null }
    : null;
}
