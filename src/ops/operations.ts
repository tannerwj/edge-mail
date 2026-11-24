import type { Bindings, Principal } from "../env";
import { administrator } from "./access";
import { migration } from "../snapshot-tables";
import { dailyLimit } from "./budgets";

const required = [
  "DB",
  "MAIL",
  "OAUTH_KV",
  "LOADER",
  "LIVE",
  "INGEST",
  "OUTBOX_CLOCK",
  "SETUP_LIMIT",
  "SETUP_TOKEN",
  "ASSETS",
  "ACCESS_TEAM_DOMAIN",
  "ACCESS_AUD",
] as const;

export async function readiness(env: Bindings) {
  const missing: string[] = required.filter((key) => !env[key]);
  if (env.SEND_MODE === "cloudflare") {
    for (const key of ["OUTBOUND", "SEND_FROM", "SEND_MAILBOX"] as const)
      if (!env[key]) missing.push(key);
  }
  // A skipped migration must fail readiness even when older mail tables still exist.
  const result = env.DB
    ? await env.DB.prepare("SELECT 1 AS present FROM d1_migrations WHERE name=?")
        .bind(migration)
        .all()
        .catch(() => null)
    : null;
  const schemaReady = result?.results.length === 1;
  return { schemaReady, missing, databaseBytes: result?.meta.size_after ?? 0 };
}

export async function operations(env: Bindings, principal: Principal) {
  administrator(principal);
  const common = { ...(await readiness(env)), dailyLimit };
  if (!common.schemaReady) return { ...common, activity: null };
  const activity = await env.DB.prepare(`SELECT
    (SELECT count(*) FROM delivery_events WHERE kind='complained') AS complaints,
    (SELECT count(*) FROM ingest_failures) AS ingestFailures,
    (SELECT count(*) FROM outbox WHERE state='uncertain') AS uncertain,
    (SELECT count(*) FROM outbox WHERE state='deferred') AS deferred,
    (SELECT MIN(due_ms) FROM outbox WHERE state IN ('held','deferred')) AS nextDue,
    (SELECT paused FROM outbox_control WHERE id=1) AS paused,
    (SELECT coalesce(sum(units),0) FROM send_reservations WHERE day=date('now')) AS reserved,
    (SELECT max(finished_at) FROM snapshot_runs WHERE phase='complete') AS lastBackup,
    (SELECT phase FROM snapshot_runs WHERE phase!='complete' ORDER BY created_at LIMIT 1) AS backupPhase`).first();
  return { ...common, activity };
}
