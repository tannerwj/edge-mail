import { createHash } from "node:crypto";
import { ephemeralTables, tables, snapshotTables, migration } from "./snapshot-tables";
import type { Bindings } from "./env";

type Run = {
  schema_version: string;
  id: string;
  phase: string;
  bookmark: string;
  table_no: number;
  cursor: number;
  part: number;
  object_cursor: string | null;
  created_at: string;
  started_ms: number;
};
type Part = { key: string; digest: string; count: number };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const root = (id: string) => "snapshots/" + id + "/";
const active = "phase IN ('starting','rows','objects','publishing')";
export async function beginSnapshot(env: Bindings) {
  const session = env.DB.withSession("first-primary"),
    now = new Date().toISOString(),
    id = now.slice(0, 10);
  const expired = Date.now() - 600000;
  await session.batch([
    session
      .prepare(
        "DELETE FROM snapshot_original WHERE EXISTS(SELECT 1 FROM snapshot_runs WHERE phase='starting' AND started_ms<?)",
      )
      .bind(expired),
    session
      .prepare(
        "UPDATE snapshot_runs SET phase='queued',started_ms=NULL WHERE phase='starting' AND started_ms<?",
      )
      .bind(expired),
  ]);
  await session
    .prepare("INSERT INTO snapshot_runs(id,created_at) VALUES (?,?) ON CONFLICT DO NOTHING")
    .bind(id, now)
    .run();
  const record = await session
    .prepare(
      "UPDATE snapshot_runs SET phase='starting',started_ms=?,schema_version=? WHERE id=(SELECT id FROM snapshot_runs WHERE phase='queued' ORDER BY created_at,id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM snapshot_runs WHERE " +
        active +
        ") RETURNING id",
    )
    .bind(Date.now(), migration)
    .first<string>("id");
  if (!record) return;
  const bookmark = session.getBookmark();
  if (!bookmark) throw Error("Snapshot bookmark unavailable");
  const known = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{
    name: string;
  }>();
  if (
    known.results.some(
      (t) =>
        !tables.some((expected) => expected === t.name) &&
        !ephemeralTables.has(t.name) &&
        !/^(sqlite_|_cf_|search_fts($|_)|snapshot_|d1_migrations$)/.test(t.name),
    )
  )
    throw Error("Unregistered snapshot table");
  const covered = await env.DB.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'snapshot_%'",
  ).first<number>("n");
  if (covered !== tables.length * 3) throw Error("Snapshot triggers missing");
  await env.DB.prepare(
    "UPDATE snapshot_runs SET phase='rows',bookmark=? WHERE id=? AND phase='starting'",
  )
    .bind(bookmark, record)
    .run();
}
async function part(
  env: Bindings,
  run: Run,
  name: string,
  value: object,
  count: number,
): Promise<Part> {
  const key = root(run.id) + name,
    text = JSON.stringify(value),
    digest = hash(text);
  const previous = await env.MAIL.put(key, text, {
    onlyIf: { etagDoesNotMatch: "*" },
    customMetadata: { digest },
  });
  if (!previous && (await env.MAIL.head(key))?.customMetadata?.digest !== digest)
    throw Error("Snapshot part conflict");
  return { key, digest, count };
}
function savePart(env: Bindings, id: string, p: Part) {
  return env.DB.prepare(
    "INSERT INTO snapshot_parts(run_id,key,digest,count) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
  ).bind(id, p.key, p.digest, p.count);
}
async function rows(env: Bindings, run: Run) {
  const table = snapshotTables(run.schema_version)[run.table_no];
  if (!table) {
    await env.DB.prepare(
      "UPDATE snapshot_runs SET phase='objects',table_no=0,part=0 WHERE id=? AND phase='rows' AND table_no=?",
    )
      .bind(run.id, run.table_no)
      .run();
    return;
  }
  // Original records win. A NULL original marks a row first inserted after the recovery point.
  const cols = await env.DB.prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid")
    .bind(table)
    .all<{ name: string }>();
  const fields = cols.results
    .map(({ name }) => {
      if (!/^\w+$/.test(name)) throw Error("Invalid column");
      return "'" + name + "',s." + name;
    })
    .join(",");
  const page =
    await env.DB.prepare(`SELECT s.rowid AS seq,json_object(${fields}) AS data FROM ${table} s WHERE s.rowid>? AND NOT EXISTS(
    SELECT 1 FROM snapshot_original o WHERE o.source=? AND o.seq=s.rowid)
    UNION ALL SELECT seq,original AS data FROM snapshot_original WHERE source=? AND seq>? AND original IS NOT NULL ORDER BY seq LIMIT 16`)
      .bind(run.cursor, table, table, run.cursor)
      .all<{ seq: number; data: string }>();
  const batch: D1PreparedStatement[] = [];
  if (page.results.length) {
    const p = await part(
      env,
      run,
      table + "/" + run.part + ".json",
      { table, rows: page.results.map((r) => JSON.parse(r.data)) },
      page.results.length,
    );
    batch.push(savePart(env, run.id, p));
  }
  const more = page.results.length === 16;
  batch.push(
    env.DB.prepare(
      "UPDATE snapshot_runs SET table_no=?,cursor=?,part=? WHERE id=? AND phase='rows' AND table_no=? AND cursor=?",
    ).bind(
      more ? run.table_no : run.table_no + 1,
      more ? page.results[15].seq : 0,
      more ? run.part + 1 : 0,
      run.id,
      run.table_no,
      run.cursor,
    ),
  );
  await env.DB.batch(batch);
}
const prefixes = ["raw/", "sent/", "body/", "att/", "html/", "deletions/"];
type Inventory = { objects: { key: string; size: number; etag: string }[]; next: string | null };
async function objects(env: Bindings, run: Run) {
  const name = "inventory/" + run.part + ".json",
    key = root(run.id) + name;
  let existing = await env.MAIL.get(key);
  if (!existing) {
    const list = await env.MAIL.list({
      prefix: prefixes[run.table_no],
      cursor: run.object_cursor || undefined,
      limit: 100,
      include: ["customMetadata"],
    });
    const inventory: Inventory = {
      objects: list.objects
        .filter((o) => /^(raw|sent|body|att|html|deletions)\//.test(o.key))
        .map((object) => ({
          key: object.key,
          size: object.size,
          etag: object.etag,
          customMetadata: object.customMetadata,
        })),
      next: list.truncated ? list.cursor : null,
    };
    const text = JSON.stringify(inventory);
    await env.MAIL.put(key, text, {
      onlyIf: { etagDoesNotMatch: "*" },
      customMetadata: { digest: hash(text) },
    });
    existing = await env.MAIL.get(key);
  }
  if (!existing) throw Error("Inventory missing");
  const text = await existing.text(),
    entry: Inventory = JSON.parse(text),
    digest = hash(text);
  if (digest !== existing.customMetadata?.digest) throw Error("Inventory damaged");
  await env.DB.batch([
    savePart(env, run.id, { key, digest, count: entry.objects.length }),
    env.DB.prepare(
      "UPDATE snapshot_runs SET object_cursor=?,part=part+1,table_no=?,phase=? WHERE id=? AND phase='objects' AND part=?",
    ).bind(
      entry.next,
      entry.next ? run.table_no : run.table_no + 1,
      entry.next || run.table_no + 1 < prefixes.length ? "objects" : "publishing",
      run.id,
      run.part,
    ),
  ]);
}
async function publish(env: Bindings, run: Run) {
  const parts = await env.DB.prepare(
    "SELECT key,digest,count FROM snapshot_parts WHERE run_id=? ORDER BY key",
  )
    .bind(run.id)
    .all<Part>();
  const manifest = {
    format: 1,
    id: run.id,
    at: new Date(run.started_ms).toISOString(),
    bookmark: run.bookmark,
    migration: run.schema_version,
    tables: snapshotTables(run.schema_version),
    parts: parts.results,
  };
  await part(env, run, "manifest.json", manifest, parts.results.length);
  // Clear history only for this still-active run. A concurrent publisher cannot erase the next run's data.
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM snapshot_original WHERE EXISTS(SELECT 1 FROM snapshot_runs WHERE id=? AND phase='publishing')",
    ).bind(run.id),
    env.DB.prepare(
      "UPDATE snapshot_runs SET phase='complete',finished_at=? WHERE id=? AND phase='publishing'",
    ).bind(new Date().toISOString(), run.id),
  ]);
}
export async function snapshot(env: Bindings) {
  // Thirty-two bounded pages fit a small mailbox in one cron. Larger instances continue at the saved cursor.
  await beginSnapshot(env);
  for (let step = 0; step < 32; step++) {
    const run = await env.DB.prepare(
      "SELECT * FROM snapshot_runs WHERE " + active + " LIMIT 1",
    ).first<Run>();
    if (!run || run.phase === "starting") return;
    if (run.phase === "rows") await rows(env, run);
    else if (run.phase === "objects") await objects(env, run);
    else await publish(env, run);
  }
}
