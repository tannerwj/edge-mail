import { blockedObject } from "../src/erasure-ledger";
import { ingest, receiptJob } from "../src/ops/ingest";
type Env = { DB: D1Database; SOURCE: R2Bucket; TARGET: R2Bucket };
async function replay(env: Env, key: string) {
  const job = receiptJob(key);
  if (await blockedObject(env.DB, key)) return;
  if (!(await env.DB.prepare("SELECT 1 FROM mailboxes WHERE id=?").bind(job.mailbox).first())) {
    // A mailbox created after the bookmark has no reviewed membership in the restore.
    await env.DB.prepare("INSERT OR IGNORE INTO restore_unmapped_receipts VALUES(?,?)")
      .bind(key, job.mailbox)
      .run();
    return;
  }
  const obj = await env.SOURCE.get(key);
  if (!obj) throw Error("Recovery receipt disappeared; check the source deletion journal");
  const copy = await env.TARGET.put(key, obj.body, {
    customMetadata: obj.customMetadata,
    httpMetadata: obj.httpMetadata,
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (!copy && (await env.TARGET.head(key))?.etag !== obj.etag)
    throw Error("Recovery receipt conflict");
  await ingest({ DB: env.DB, MAIL: env.TARGET, recovery: true }, job, key);
}
export async function recoverReceipts(env: Env) {
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS restore_receipt_scan(id INTEGER PRIMARY KEY,last_key TEXT,cutoff INTEGER,done INTEGER)",
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS restore_unmapped_receipts(key TEXT PRIMARY KEY,box TEXT)",
    ),
    env.DB.prepare("INSERT OR IGNORE INTO restore_receipt_scan VALUES(1,'',?,0)").bind(Date.now()),
  ]);
  const scan = await env.DB.prepare(
    "SELECT last_key,cutoff,done FROM restore_receipt_scan WHERE id=1",
  ).first<{ last_key: string; cutoff: number; done: number }>();
  if (!scan) throw Error("Recovery receipt checkpoint missing");
  if (scan.done) return true;
  const list = await env.SOURCE.list({
    prefix: "raw/",
    startAfter: scan.last_key || undefined,
    limit: 100,
  });
  const known = await env.DB.prepare(
    "SELECT raw_key FROM deliveries WHERE raw_key IN (SELECT value FROM json_each(?))",
  )
    .bind(JSON.stringify(list.objects.map((o) => o.key)))
    .all<{ raw_key: string }>();
  const indexed = new Set(known.results.map((r) => r.raw_key));
  let last = scan.last_key,
    recovered = 0;
  for (const obj of list.objects) {
    last = obj.key;
    if (obj.uploaded.getTime() <= scan.cutoff && !indexed.has(last)) {
      await replay(env, last);
      if (++recovered === 4) break;
    }
  }
  const done = !list.truncated && last === (list.objects.at(-1)?.key || scan.last_key);
  await env.DB.prepare(
    "UPDATE restore_receipt_scan SET last_key=?,done=? WHERE id=1 AND last_key=?",
  )
    .bind(last, Number(done), scan.last_key)
    .run();
  return done;
}
