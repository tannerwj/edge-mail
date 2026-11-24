import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { api, cf } from "./cloud-cli.mjs";

function query(target, sql) {
  return api("d1", "query", target.db, "--body", JSON.stringify({ sql }))[0].results;
}
function apply(args) {
  api(...args, "--dry-run");
  return api(...args);
}
export async function restoreTarget({ name, sourceDb, snapshot, bucket, worker }) {
  assert.match(name, /^edge-mail-drill-[0-9a-f]{12}$/);
  assert.ok(bucket !== name && bucket && sourceDb && worker);
  const existing = api("d1", "list", "--name", name).find((db) => db.name === name);
  const db = existing || apply(["d1", "create", "--name", name]);
  assert.ok(db.uuid && db.uuid !== sourceDb);
  const buckets = api("r2", "buckets", "list", "--name-contains", name);
  if (!(buckets.buckets || buckets).some((b) => b.name === name))
    apply(["r2", "buckets", "create", "--name", name]);
  const scratch = { db: db.uuid };
  const tables = query(
    scratch,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'",
  );
  if (tables.length) {
    assert.ok(
      tables.some((row) => row.name === "restore_job"),
      "Target contains data with no recovery record",
    );
    const [previous] = query(scratch, "SELECT snapshot,source FROM restore_job");
    assert.equal(previous?.snapshot, snapshot);
    assert.equal(previous?.source, sourceDb);
  }
  const migrations = ["d1", "migrations", "apply", db.uuid, "--mode", "staging"];
  if (!tables.length) {
    const listed = api("r2", "objects", "list", "--bucket-name", name);
    assert.equal((listed.objects || listed).length, 0, "Refusing populated recovery bucket");
    apply([
      "d1",
      "query",
      db.uuid,
      "--batch",
      JSON.stringify([
        {
          sql: "CREATE TABLE restore_job(snapshot TEXT PRIMARY KEY,source TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'running')",
        },
        {
          sql: "INSERT INTO restore_job(snapshot,source) VALUES(?,?)",
          params: [snapshot, sourceDb],
        },
      ]),
    ]);
  }
  apply(migrations);
  const status = () => query(scratch, "SELECT snapshot,source,state,position FROM restore_job")[0];
  const job = status();
  assert.equal(job.snapshot, snapshot);
  assert.equal(job.source, sourceDb);
  const deploy = (active) => {
    const opt = {
      stdio: "inherit",
      env: {
        ...process.env,
        EDGE_DRILL_TARGET: name,
        EDGE_DRILL_SOURCE: bucket,
        EDGE_DRILL_WORKER: worker,
        EDGE_DRILL_ACTIVE: active ? "yes" : "no",
      },
    };
    cf(["deploy", "--mode", "restore", "--dry-run"], opt);
    const config = JSON.parse(
      readFileSync(".cloudflare/output/v1/workers/default/worker.config.json"),
    );
    assert.equal(config.name, worker);
    assert.equal(config.workersDev, false);
    assert.ok(!config.domains?.length);
    assert.deepEqual(Object.keys(config.env).sort(), ["DB", "SOURCE", "TARGET"]);
    cf(["deploy", "--mode", "restore", "--prebuilt"], opt);
  };
  if (job.state !== "complete") {
    deploy(true);
    try {
      let deadline = Date.now() + 20 * 60000;
      let last = -1;
      for (;;) {
        const current = status();
        if (current.state === "complete") break;
        if (current.position !== last) {
          deadline = Date.now() + 20 * 60000;
          console.log("Restore checkpoint " + (last = current.position));
        }
        assert.ok(
          Date.now() < deadline,
          "Recovery timed out. The same snapshot resumes at its checkpoint.",
        );
        await sleep(15000);
      }
    } finally {
      deploy(false);
    }
  } else {
    // A previous operator session may have ended after recovery but before disarming the trigger.
    deploy(false);
  }
  const [evidence] = query(
    scratch,
    `SELECT (SELECT count(*) FROM messages) AS messages,(SELECT count(*) FROM search_fts) AS searchable,
    (SELECT count(*) FROM deliveries) AS envelopes,(SELECT count(*) FROM thread_members) AS conversation_members,
    (SELECT count(*) FROM messages WHERE folder='sent') AS sent_copies,(SELECT count(*) FROM users WHERE disabled_at IS NULL) AS enabled_users,
    (SELECT count(*) FROM outbox WHERE state IN ('held','deferred','claimed')) AS pending_sends,
    (SELECT count(*) FROM agent_grants WHERE revoked IS NULL) AS enabled_grants,
    (SELECT count(*) FROM webhooks WHERE enabled<>0) AS enabled_webhooks`,
  );
  assert.equal(evidence.messages, evidence.searchable);
  assert.equal(evidence.enabled_users, 0);
  assert.equal(evidence.pending_sends, 0);
  assert.equal(evidence.enabled_grants, 0);
  assert.equal(evidence.enabled_webhooks, 0);
  return { scratch, evidence };
}
