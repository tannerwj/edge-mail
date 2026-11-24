import { createHash } from "node:crypto";
import type { Bindings } from "./env";
type Store = Pick<Bindings, "DB" | "MAIL">;
// Account for the arriving original and space for its decoded body and attachments until the next inventory.
export const bytesPerMessage = 2490;
const scope = (value: string) =>
  createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
export async function reserveReceipt(
  env: Store,
  box: string,
  claim: { id: string; key: string; size: number; from: string; to: string; historical?: boolean },
) {
  if (!(await env.DB.prepare("SELECT 1 FROM mailbox_quotas WHERE mailbox_id=?").bind(box).first()))
    return true;
  const { id, key, size, from, to } = claim;
  if (claim.historical && (await env.MAIL.head(key))) return true;
  const now = Date.now(),
    minute = now - 60000;
  try {
    const result = await env.DB.prepare(
      "INSERT INTO quota_reservations(id,box,bytes,at,sender,recipient,raw_key) SELECT ?1,box,?2,?3,?4,?5,?9 FROM quota_usage JOIN mailbox_quotas q ON box=q.mailbox_id WHERE box=?6 AND (?10=1 OR sender_rate IS NULL OR (SELECT count(*) FROM quota_reservations r WHERE r.box=?6 AND r.sender=?4 AND at>?7)<sender_rate) AND (?10=1 OR recipient_rate IS NULL OR (SELECT count(*) FROM quota_reservations r WHERE r.box=?6 AND r.recipient=?5 AND at>?7)<recipient_rate) AND (d1_hard IS NULL OR (messages+1+(SELECT count(*) FROM quota_reservations r WHERE r.box=?6 AND indexed=0))*?8<=d1_hard) AND (r2_hard IS NULL OR (measured>0 AND total+?2+(SELECT coalesce(sum(bytes),0) FROM quota_reservations r WHERE r.box=?6 AND (at>=measured OR indexed=0))<=r2_hard)) ON CONFLICT(id) DO NOTHING",
    )
      .bind(
        id,
        Math.max(1, size) * 3,
        now,
        scope(from),
        scope(to),
        box,
        minute,
        bytesPerMessage,
        key,
        Number(!!claim.historical),
      )
      .run();
    return result.meta.changes > 0;
  } catch (error) {
    if (!(error instanceof Error) || !/SQLITE_FULL|database or disk is full/i.test(error.message))
      throw error;
    console.warn(JSON.stringify({ event: "quota_counter_full", box }));
    return true;
  }
}
const prefixes = ["raw", "sent", "body", "att", "att/uploads", "html"];
type Scan = { box: string; part: number; cursor: string; started: number; subtotal: number };
export async function inventoryPage(env: Store, box?: string) {
  const now = Date.now();
  const state = await env.DB.prepare(
    "SELECT * FROM quota_usage WHERE (?1 IS NULL OR box=?1) AND (started!=0 OR measured<?2) ORDER BY measured,box LIMIT 1",
  )
    .bind(box ?? null, now - 3600000)
    .first<Scan>();
  if (!state) return false;
  const start = state.started || now;
  const page = await env.MAIL.list({
    prefix: prefixes[state.part] + "/" + state.box + "/",
    cursor: state.cursor || undefined,
    limit: 500,
  });
  const total = state.subtotal + page.objects.reduce((sum, o) => sum + o.size, 0),
    part = page.truncated ? state.part : state.part + 1;
  const guard = " WHERE box=? AND part=? AND started=? AND cursor=?",
    bindings = [state.box, state.part, state.started, state.cursor];
  if (part < prefixes.length) {
    await env.DB.prepare("UPDATE quota_usage SET started=?,subtotal=?,part=?,cursor=?" + guard)
      .bind(start, total, part, page.truncated ? page.cursor : "", ...bindings)
      .run();
    return true;
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE quota_usage SET measured=?,total=?,part=0,cursor='',started=0,subtotal=0" + guard,
    ).bind(start, total, ...bindings),
    env.DB.prepare(
      "DELETE FROM quota_reservations WHERE box=? AND indexed=1 AND at<min(?,(SELECT measured FROM quota_usage WHERE box=?))",
    ).bind(state.box, now - 60000, state.box),
    env.DB.prepare(
      "INSERT INTO ops_alerts(id,code,created,last_seen) SELECT 'quota-'||box||'-'||date('now'),'mailbox_soft_quota',?,? FROM quota_usage u JOIN mailbox_quotas q ON u.box=q.mailbox_id WHERE u.box=? AND (total>=r2_soft OR messages*?>=d1_soft) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen",
    ).bind(now, now, state.box, bytesPerMessage),
  ]);
  return true;
}

export async function sweepCapacity(env: Store) {
  const old = await env.DB.prepare(
    "SELECT id,raw_key FROM quota_reservations WHERE indexed=0 AND at<? ORDER BY at LIMIT 8",
  )
    .bind(Date.now() - 86400000)
    .all<{ id: string; raw_key: string }>();
  for (const r of old.results) {
    if (!(await env.MAIL.head(r.raw_key)))
      await env.DB.prepare("DELETE FROM quota_reservations WHERE id=? AND indexed=0")
        .bind(r.id)
        .run();
    else
      await env.DB.prepare(
        "UPDATE quota_reservations SET indexed=1 WHERE id=? AND (EXISTS(SELECT 1 FROM deliveries WHERE raw_key=?) OR EXISTS(SELECT 1 FROM erased_objects WHERE key=?))",
      )
        .bind(r.id, r.raw_key, r.raw_key)
        .run();
  }
  await inventoryPage(env);
}
