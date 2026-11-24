import { Problem, type Bindings } from "../env";
import { refreshAnalytics, accountUsage } from "./account-analytics";
import { administrator, type User } from "./access";
export const dailyLimit = 100;
export const writesOn = "coalesce((SELECT agent_writes FROM instance_policy WHERE id=1),0)=1";
const owner = "EXISTS(SELECT 1 FROM users WHERE id=? AND role='owner' AND disabled_at IS NULL)";
const monthStart = "date('now','start of month')";
export function budgetClaims(env: Bindings, id: string, now: number, due: string) {
  const month =
    "(SELECT coalesce(sum(units),0) FROM send_reservations s WHERE s.day>=" +
    monthStart +
    " AND s.item!=outbox.id)+units>(SELECT monthly_cap FROM instance_policy WHERE id=1)";
  const user =
    "(SELECT coalesce(sum(units),0) FROM send_reservations s WHERE s.day=date('now') AND s.actor=outbox.actor AND s.item!=outbox.id)+units>coalesce((SELECT daily_cap FROM user_limits WHERE actor=outbox.actor),?)";
  return [
    env.DB.prepare(
      "UPDATE outbox SET state='deferred',error_code='monthly_instance_limit',due_ms=unixepoch('now','start of month','+1 month')*1000" +
        due +
        " AND " +
        month,
    ).bind(id, now),
    env.DB.prepare(
      "UPDATE outbox SET state='deferred',error_code='user_daily_limit',due_ms=unixepoch('now','start of day','+1 day')*1000" +
        due +
        " AND " +
        user,
    ).bind(id, now, dailyLimit),
  ];
}
export async function operatingLimits(env: Bindings, u: User) {
  administrator(u);
  const results = await env.DB.batch([
    env.DB.prepare(
      "SELECT monthly_cap,agent_writes,(SELECT paused FROM outbox_control WHERE id=1) paused,(SELECT coalesce(sum(units),0) FROM send_reservations WHERE day>=" +
        monthStart +
        ") monthly_used FROM instance_policy WHERE id=1",
    ),
    env.DB.prepare(
      "SELECT l.actor,l.daily_cap,min(e.email) email FROM user_limits l JOIN user_emails e ON e.user_id=l.actor GROUP BY l.actor ORDER BY email",
    ),
    env.DB.prepare(
      "SELECT id,code,created,resolved FROM ops_alerts WHERE resolved IS NULL ORDER BY created DESC LIMIT 60",
    ),
  ]);
  return {
    policy: results[0].results[0],
    users: results[1].results,
    alerts: results[2].results,
    account_analytics: await accountUsage(env),
  };
}
function cap(v: unknown, nullable: boolean) {
  if (v === null && nullable) return null;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > 10000000)
    throw new Problem(400, "Choose a positive recipient limit up to ten million");
  return v;
}
export async function changeLimits(env: Bindings, u: User, a: Record<string, unknown>) {
  if (u.role !== "owner") throw new Problem(403, "Instance owner required");
  let stmt: D1PreparedStatement;
  if (a.action === "ack" && typeof a.id === "string")
    stmt = env.DB.prepare(
      "UPDATE ops_alerts SET resolved=coalesce(resolved,?) WHERE id=? AND " + owner,
    ).bind(Date.now(), a.id, u.id);
  else if (a.action === "monthly")
    stmt = env.DB.prepare("UPDATE instance_policy SET monthly_cap=? WHERE id=1 AND " + owner).bind(
      cap(a.cap, true),
      u.id,
    );
  else if (a.action === "agent_writes" && typeof a.enabled === "boolean")
    stmt = env.DB.prepare("UPDATE instance_policy SET agent_writes=? WHERE id=1 AND " + owner).bind(
      Number(a.enabled),
      u.id,
    );
  else if (a.action === "sending" && typeof a.enabled === "boolean")
    stmt = env.DB.prepare("UPDATE outbox_control SET paused=? WHERE id=1 AND " + owner).bind(
      Number(!a.enabled),
      u.id,
    );
  else if (a.action === "user" && typeof a.email === "string")
    stmt = env.DB.prepare(
      "INSERT INTO user_limits SELECT user_id,? FROM user_emails WHERE email=? COLLATE NOCASE AND " +
        owner +
        " ON CONFLICT(actor) DO UPDATE SET daily_cap=excluded.daily_cap",
    ).bind(cap(a.cap, false), a.email.trim(), u.id);
  else throw new Problem(400, "Choose an operating limit");
  const r = await stmt.run();
  if (!r.meta.changes) throw new Problem(404, "Setting or account unavailable");
  if (a.action === "monthly" || a.action === "user" || a.action === "sending")
    await env.DB.prepare(
      "UPDATE outbox SET due_ms=max(unixepoch('subsec')*1000,coalesce(json_extract(letter,'$.scheduledFor'),0)) WHERE state='deferred' AND error_code IN('monthly_instance_limit','user_daily_limit','budget_or_pause')",
    ).run();
  return { saved: true };
}
export async function checkOperatingAlerts(env: Bindings) {
  const now = Date.now(),
    day = new Date(now).toISOString().slice(0, 10);
  await refreshAnalytics(env);
  const usage = await accountUsage(env);
  const checks = await env.DB.prepare(
    "SELECT (SELECT count(*) FROM ingest_failures) failures,(SELECT count(*) FROM outbox WHERE state='held' AND due_ms<? AND NOT EXISTS(SELECT 1 FROM agent_reviews WHERE id=outbox.id AND state='pending')) stale,(SELECT monthly_cap FROM instance_policy WHERE id=1) cap,(SELECT coalesce(sum(units),0) FROM send_reservations WHERE day>=" +
      monthStart +
      ") used",
  )
    .bind(now - 900000)
    .all<{ failures: number; stale: number; cap: number | null; used: number }>();
  const v = checks.results[0],
    bytes = checks.meta.size_after;
  const codes = [
    ...(usage && usage.operations >= 2400 ? ["account_warning"] : []),
    ...(v.failures ? ["ingest_failure"] : []),
    ...(v.stale ? ["outbox_late"] : []),
    ...(v.cap && v.used >= v.cap * 0.8 ? ["monthly_warning"] : []),
    ...(bytes >= 9e9 ? ["database_90"] : bytes >= 8e9 ? ["database_80"] : []),
  ];
  if (codes.length)
    await env.DB.batch(
      codes.map((code) =>
        env.DB.prepare(
          "INSERT INTO ops_alerts(id,code,created,last_seen) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen",
        ).bind(code + "-" + day, code, now, now),
      ),
    );
}
