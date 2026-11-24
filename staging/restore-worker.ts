import { recoverReceipts } from "./restore-receipts";
import { restorePeople, missingPrivateUpload } from "./restore-people";
import { blockedObject } from "../src/erasure-ledger";
import { scanErased, finishErased } from "./restore-erasure";
import { createHash } from "node:crypto";
import { tables, snapshotTables } from "../src/snapshot-tables";
type Env = { DB: D1Database; SOURCE: R2Bucket; TARGET: R2Bucket };
type Part = { key: string; digest: string; count: number };
type Manifest = {
  format: number;
  id: string;
  bookmark: string;
  migration: string;
  tables: string[];
  parts: Part[];
};
type Job = { snapshot: string; position: number };
type ObjectEntry = { key: string; etag: string; size: number };
type Data = Record<string, string | number | null>;
const hash = (data: string) => createHash("sha256").update(data).digest("hex");
async function read(env: Env, key: string, digest?: string) {
  const object = await env.SOURCE.get(key);
  if (!object) throw Error("Snapshot is incomplete");
  const text = await object.text();
  if (hash(text) !== (digest || object.customMetadata?.digest))
    throw Error("Snapshot checksum mismatch");
  return JSON.parse(text);
}
async function copy(env: Env, entry: ObjectEntry) {
  if (!/^(raw|sent|body|html|att|deletions)\//.test(entry.key)) throw Error("Invalid archived key");
  if (await blockedObject(env.DB, entry.key)) return;
  const present = await env.TARGET.head(entry.key);
  if (present) {
    if (present.size !== entry.size || present.etag !== entry.etag)
      throw Error("Restore object conflict");
    return;
  }
  const source = await env.SOURCE.get(entry.key);
  if (!source && (await missingPrivateUpload(env.DB, entry.key))) return;
  if (!source || source.size !== entry.size || source.etag !== entry.etag)
    throw Error("Source object changed");
  await env.TARGET.put(entry.key, source.body, {
    customMetadata: source.customMetadata,
    httpMetadata: source.httpMetadata,
    onlyIf: { etagDoesNotMatch: "*" },
  });
}
function disarm(table: string, row: Data) {
  if (table === "agent_reviews" && row.state === "pending") {
    row.state = "cancelled";
    row.request = null;
  }
  if (table === "users") row.disabled_at ||= new Date().toISOString();
  if (table === "temporary_addresses") {
    row.disabled = 1;
    row.reason = "restore";
  }
  if (table === "unknown_recipient_policy") {
    row.mode = "reject";
    row.mailbox_id = null;
  }
  if (table === "egress_destinations") row.disabled = 1;
  if (table === "webhooks") row.enabled = 0;
  if (table === "agent_grants") row.revoked ||= Date.now();
  if (table === "instance_policy") row.agent_writes = 0;
  if (table === "outbox_control") row.paused = 1;
  if (table === "outbox" && ["held", "deferred", "claimed"].includes(String(row.state))) {
    row.state = row.state === "claimed" ? "uncertain" : "cancelled";
    row.error_code = "restore_review_required";
  }
  if (table === "reconciliation") row.cursor = null;
}
async function restoredRow(env: Env, table: string, row: Data) {
  disarm(table, row);
  if (
    table === "messages" &&
    (await env.DB.prepare("SELECT 1 FROM erasures WHERE box=? AND hash=?")
      .bind(row.mailbox_id, row.content_hash)
      .first())
  ) {
    row.body_key = "erased";
    row.subject = "";
    row.snippet = "";
    row.sender = "";
  }
  const cols = Object.keys(row);
  if (!cols.every((c) => /^[a-z_]+$/.test(c))) throw Error("Invalid column");
  const insert = env.DB.prepare(
    "INSERT " +
      (["reconciliation", "outbox_control", "instance_policy"].includes(table)
        ? "OR REPLACE "
        : "") +
      "INTO " +
      table +
      "(" +
      cols.join(",") +
      ") VALUES(" +
      cols.map(() => "?").join(",") +
      ")",
  ).bind(...cols.map((c) => row[c]));
  if (table !== "messages" || row.body_key === "erased") return [insert];
  const body = await env.TARGET.get(String(row.body_key), { range: { offset: 0, length: 16384 } });
  if (!body) throw Error("Restored body missing");
  return [
    insert,
    env.DB.prepare("INSERT INTO search_fts(rowid,subject,body_text) VALUES(?,?,?)").bind(
      row.rowid,
      row.subject,
      await body.text(),
    ),
  ];
}
async function restorePart(env: Env, job: Job, part: Part) {
  const local = part.key.slice(("snapshots/" + job.snapshot + "/").length).split("/")[0];
  const doc = await read(env, part.key, part.digest);
  const batch: D1PreparedStatement[] = [];
  if (local === "inventory") {
    if (doc.objects.length !== part.count) throw Error("Inventory count mismatch");
    for (const item of doc.objects) await copy(env, item);
  } else {
    if (!tables.some((t) => t === local) || doc.table !== local || doc.rows.length !== part.count)
      throw Error("Unrecognized snapshot part");
    for (const row of doc.rows) batch.push(...(await restoredRow(env, local, row)));
  }
  batch.push(
    env.DB.prepare(
      "UPDATE restore_job SET position=position+1 WHERE snapshot=? AND position=?",
    ).bind(job.snapshot, job.position),
  );
  await env.DB.batch(batch);
}
async function finish(env: Env) {
  const integrity = await env.DB.prepare("PRAGMA foreign_key_check").all();
  if (integrity.results.length) throw Error("Restored foreign keys failed");
  const results =
    await env.DB.prepare(`SELECT (SELECT count(*) FROM messages) AS messages,(SELECT count(*) FROM search_fts) AS indexed,
 (SELECT count(*) FROM users WHERE disabled_at IS NULL) AS enabled,(SELECT count(*) FROM outbox WHERE state IN ('held','deferred','claimed')) AS pending,
 (SELECT paused FROM outbox_control WHERE id=1) AS paused`).first<{
      messages: number;
      indexed: number;
      enabled: number;
      pending: number;
      paused: number;
    }>();
  if (
    !results ||
    results.messages !== results.indexed ||
    results.enabled !== 0 ||
    results.pending !== 0 ||
    results.paused !== 1
  )
    throw Error("Restore isolation check failed");
  await env.DB.prepare("UPDATE restore_job SET state='complete' WHERE state='running'").run();
}
export async function restore(env: Env) {
  const job = await env.DB.prepare(
    "SELECT snapshot,position FROM restore_job WHERE state='running'",
  ).first<Job>();
  if (!job) return;
  const prefix = "snapshots/" + job.snapshot + "/";
  const manifest: Manifest = await read(env, prefix + "manifest.json");
  if (
    manifest.format !== 1 ||
    manifest.id !== job.snapshot ||
    !manifest.bookmark ||
    JSON.stringify(manifest.tables) !== JSON.stringify(snapshotTables(manifest.migration))
  )
    throw Error("Incompatible snapshot");
  // Copy bytes and transport metadata first, then insert rows in foreign-key order.
  const ordered = ["inventory", ...manifest.tables].flatMap((name) =>
    manifest.parts.filter((p) => p.key.startsWith(prefix + name + "/")),
  );
  if (ordered.length !== manifest.parts.length) throw Error("Unexpected snapshot part");
  if (!(await scanErased(env, "start"))) return;
  for (let n = 0; n < 12; n++) {
    const part = ordered[job.position];
    if (!part) {
      if (!(await recoverReceipts(env))) return;
      if ((await finishErased(env)) && (await restorePeople(env))) await finish(env);
      return;
    }
    await restorePart(env, job, part);
    job.position++;
  }
}
export default {
  fetch() {
    return new Response(null, { status: 403 });
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    try {
      await restore(env);
    } catch (error) {
      // Operational diagnostics contain no mail content or credentials.
      console.error(
        JSON.stringify({
          event: "restore_failed",
          type: error instanceof Error ? error.name : "unknown",
        }),
      );
      // A subsequent scheduled run resumes from the last atomic checkpoint.
    }
  },
};
