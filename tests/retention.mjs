import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";

const dir = await mkdtemp(join(tmpdir(), "edge-retention-"));
let worker;
try {
  const config = join(dir, "wrangler.json");
  await writeFile(
    config,
    JSON.stringify({
      name: "retention-fixture",
      main: resolve("tests/retention-worker.ts"),
      compatibility_date: "2026-11-19",
      compatibility_flags: ["nodejs_compat"],
    }),
  );
  execFileSync(
    "./node_modules/.bin/wrangler",
    ["deploy", "--config", config, "--dry-run", "--outdir", dir],
    { stdio: "pipe" },
  );
  worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: [
        {
          type: "ESModule",
          path: "retention-worker.js",
          contents: await readFile(join(dir, "retention-worker.js"), "utf8"),
        },
      ],
      compatibilityDate: "2026-11-19",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB", "RECOVERED"],
      r2Buckets: ["MAIL", "TARGET"],
    }),
  );
  const db = await worker.getD1Database("DB"),
    target = await worker.getD1Database("RECOVERED");
  for (const name of (await readdir("migrations")).filter((n) => n.endsWith(".sql")).sort()) {
    const statements = unstable_splitSqlQuery(await readFile(join("migrations", name), "utf8"));
    for (const database of [db, target])
      await database.batch(statements.map((s) => database.prepare(s)));
  }
  const box = "00000000000000000000000001";
  await db.batch([
    db.prepare("INSERT INTO users(id,role) VALUES('owner','owner')"),
    db.prepare("INSERT INTO domains VALUES('domain','example.test','owner')"),
    db
      .prepare("INSERT INTO mailboxes VALUES(?,'domain','mail@example.test','Shared','owner')")
      .bind(box),
  ]);
  const forgotten = "00000000000000000000000003",
    privateBox = "00000000000000000000000004",
    operator = "00000000000000000000000002";
  await db.batch([
    db
      .prepare("INSERT INTO users(id,role) VALUES(?,'owner'),(?,'member')")
      .bind(operator, forgotten),
    db.prepare("INSERT INTO user_emails VALUES('forgotten@example.test',?)").bind(forgotten),
    db
      .prepare("INSERT INTO mailboxes VALUES(?,'domain','private@example.test','Private',?)")
      .bind(privateBox, forgotten),
    db.prepare("INSERT INTO mailbox_members VALUES(?,?,'owner')").bind(privateBox, forgotten),
    db
      .prepare(
        "INSERT INTO drafts(id,mailbox_id,actor,content,revision,updated_at) VALUES(?,?,?,'{}',1,CURRENT_TIMESTAMP)",
      )
      .bind("00000000000000000000000005", box, forgotten),
  ]);
  const sourceObjects = await worker.getR2Bucket("MAIL");
  const draftFile = "att/uploads/" + box + "/00000000000000000000000005/" + "f".repeat(64);
  await sourceObjects.put(draftFile, "private draft attachment");
  const call = async (path, body, headers = {}) => {
    const r = await worker.dispatchFetch("http://fixture.test/" + path, {
      method: "POST",
      headers,
      body,
    });
    assert.ok(r.ok, path + " " + r.status + " " + (!r.ok ? await r.text() : ""));
  };
  const upload = (word) => {
    const raw =
      "From: sender@example.test\r\nTo: mail@example.test\r\nSubject: " +
      word +
      "\r\n\r\n" +
      word +
      " example content.";
    return call("import", raw, {
      "Content-Type": "message/rfc822",
      "Content-Length": String(Buffer.byteLength(raw)),
    });
  };
  for (const word of ["Albatross", "Marigold", "Primrose"]) await upload(word);
  const erased = await db
    .prepare(
      "SELECT m.id,d.raw_key,m.body_key FROM messages m JOIN deliveries d ON d.message_id=m.id WHERE subject='Albatross'",
    )
    .first();
  let snap;
  for (let i = 0; i < 10 && !snap; i++) {
    await call("snapshot");
    snap = await db.prepare("SELECT id FROM snapshot_runs WHERE phase='complete'").first("id");
  }
  assert.ok(snap);
  const late = "00000000000000000000000007",
    lateKey = "raw/" + box + "/2026/11/" + late + ".eml";
  const privateEnvelope = {
    id: late,
    mailbox: box,
    to: "hidden@example.test",
    from: "sender@example.test",
    matched: "mail@example.test",
    kind: "alias",
    tag: null,
    at: new Date().toISOString(),
    auth: {},
  };
  await sourceObjects.put(
    lateKey,
    "From: sender@example.test\r\nTo: undisclosed-recipients:;\r\nSubject: After the recovery point\r\n\r\nLarkspur",
    { customMetadata: { receipt: JSON.stringify(privateEnvelope) } },
  );

  for (let attempt = 0; attempt < 12 && (await sourceObjects.head(draftFile)); attempt++)
    await call("erase-person");
  assert.equal(await sourceObjects.head(draftFile), null);
  await call("erase", erased.id);
  await db.prepare("UPDATE messages SET folder='trash' WHERE subject='Primrose'").run();
  await db.prepare("UPDATE trash_retention SET since=0").run();
  await call("sweep");
  await target
    .prepare("CREATE TABLE restore_job(snapshot TEXT PRIMARY KEY,state TEXT,position INTEGER)")
    .run();
  await target.prepare("INSERT INTO restore_job VALUES(?,'running',0)").bind(snap).run();
  for (let i = 0; i < 20; i++) {
    await call("restore");
    if (await target.prepare("SELECT 1 FROM restore_job WHERE state='complete'").first()) break;
  }
  assert.equal(await target.prepare("SELECT state FROM restore_job").first("state"), "complete");
  assert.equal(
    await target.prepare("SELECT 1 FROM mailboxes WHERE id=?").bind(privateBox).first(),
    null,
  );
  assert.equal(
    await target.prepare("SELECT 1 FROM user_emails WHERE user_id=?").bind(forgotten).first(),
    null,
  );
  assert.equal(
    await target.prepare("SELECT 1 FROM drafts WHERE actor=?").bind(forgotten).first(),
    null,
  );

  const lateDelivery = await target
    .prepare(
      "SELECT d.envelope_to,d.kind,m.folder FROM deliveries d JOIN messages m ON m.id=d.message_id WHERE d.id=?",
    )
    .bind(late)
    .first();
  assert.deepEqual(lateDelivery, {
    envelope_to: "hidden@example.test",
    kind: "alias",
    folder: "inbox",
  });
  assert.equal(
    await target
      .prepare("SELECT count(*) n FROM search_fts WHERE search_fts MATCH 'Larkspur'")
      .first("n"),
    1,
  );
  assert.equal(
    await target
      .prepare(
        "SELECT (SELECT count(*) FROM outbox)+(SELECT count(*) FROM rule_runs)+(SELECT count(*) FROM webhook_jobs)+(SELECT count(*) FROM push_jobs) n",
      )
      .first("n"),
    0,
  );
  assert.equal(await target.prepare("SELECT count(*) AS n FROM messages").first("n"), 2);
  assert.equal(
    await target
      .prepare("SELECT count(*) AS n FROM search_fts WHERE search_fts MATCH 'Marigold'")
      .first("n"),
    1,
  );
  assert.equal(
    await target
      .prepare(
        "SELECT count(*) AS n FROM search_fts WHERE search_fts MATCH 'Albatross OR Primrose'",
      )
      .first("n"),
    0,
  );
  assert.equal(
    await target.prepare("SELECT count(*) AS n FROM erasures WHERE hidden=1").first("n"),
    2,
  );
  const objects = await worker.getR2Bucket("TARGET");
  for (const key of [erased.raw_key, erased.body_key, draftFile])
    assert.equal(await objects.head(key), null);
  assert.equal((await objects.list({ prefix: "deletions/messages/" })).objects.length, 2);
  console.log(
    "PASS · restoring a backup taken before owner erasure and automatic Trash expiry preserves both deletions and the surviving searchable message",
  );
} finally {
  await worker?.dispose();
  await rm(dir, { recursive: true, force: true });
}
