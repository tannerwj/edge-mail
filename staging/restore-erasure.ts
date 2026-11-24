import {
  indexMarker,
  validateMarker,
  hideErased,
  cleanupObjects,
  type Erasure,
} from "../src/erasure-ledger";
type Env = { SOURCE: R2Bucket; TARGET: R2Bucket; DB: D1Database };
// Re-read the source ledger immediately before opening the recovery point. Restore keeps users disabled.
export async function scanErased(env: Env, phase: "start" | "finish") {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS restore_erasure_scan(phase TEXT PRIMARY KEY,cursor TEXT,done INTEGER NOT NULL DEFAULT 0)",
  ).run();
  const state = await env.DB.prepare("SELECT cursor,done FROM restore_erasure_scan WHERE phase=?")
    .bind(phase)
    .first<{ cursor: string | null; done: number }>();
  if (state?.done) return true;
  const list = await env.SOURCE.list({
    prefix: "deletions/",
    limit: 12,
    cursor: state?.cursor || undefined,
  });
  for (const entry of list.objects) {
    const obj = await env.SOURCE.get(entry.key);
    if (!obj) throw Error("Deletion record missing");
    const data = await obj.text(),
      mark = validateMarker(JSON.parse(data), entry.key);
    await indexMarker(env.DB, mark);
    await env.TARGET.put(entry.key, data, { onlyIf: { etagDoesNotMatch: "*" } });
  }
  await env.DB.prepare(
    "INSERT INTO restore_erasure_scan(phase,cursor,done) VALUES(?,?,?) ON CONFLICT(phase) DO UPDATE SET cursor=excluded.cursor,done=excluded.done",
  )
    .bind(phase, list.truncated ? list.cursor : null, Number(!list.truncated))
    .run();
  return !list.truncated;
}
export async function finishErased(env: Env) {
  if (!(await scanErased(env, "finish"))) return false;
  const rows = await env.DB.prepare("SELECT box,id FROM erasures WHERE hidden=0 LIMIT 8").all<
    Pick<Erasure, "box" | "id">
  >();
  for (const m of rows.results) await hideErased({ DB: env.DB, MAIL: env.TARGET }, m.box, m.id);
  await cleanupObjects({ DB: env.DB, MAIL: env.TARGET });
  const pending = await env.DB.prepare(
    "SELECT 1 FROM erased_objects WHERE done=0 AND due<=? LIMIT 1",
  )
    .bind(Date.now())
    .first();
  return rows.results.length < 8 && !pending;
}
