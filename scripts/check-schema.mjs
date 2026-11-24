import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ephemeralTables, migration, tables } from "../src/snapshot-tables.ts";

function checkColumns(sql, name, columns) {
  for (const { name: column } of columns) {
    const field = new RegExp("'" + column + "'\\s*,\\s*(?:hex\\()?OLD\\." + column + "\\b", "i");
    assert.match(sql, field, name + " must preserve " + column);
  }
}

const directory = process.argv[2] || "migrations";
const files = readdirSync(directory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
assert.equal(files.at(-1), migration, "Snapshot format must identify the latest migration");
const db = new DatabaseSync(":memory:");
try {
  for (const [index, name] of files.entries()) {
    assert.equal(
      name.split("_")[0],
      String(index + 1).padStart(4, "0"),
      "Migration sequence: " + name,
    );
    db.exec(readFileSync(join(directory, name), "utf8"));
  }
  const inventory = db
    .prepare(
      "SELECT name FROM pragma_table_list WHERE type IN ('table','virtual') AND name NOT GLOB 'sqlite_*'",
    )
    .all();
  const internal = ["snapshot_runs", "snapshot_original", "snapshot_parts", "search_fts"];
  assert.deepEqual(
    new Set(inventory.map((row) => row.name)),
    new Set([...tables, ...ephemeralTables, ...internal]),
    "Every application table needs a recovery policy",
  );
  const trigger = db.prepare(
    "SELECT sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=? AND name=?",
  );
  for (const table of tables) {
    const columns = db.prepare("SELECT name FROM pragma_table_info(?)").all(table);
    for (const event of ["insert", "update", "delete"]) {
      const name = "snapshot_" + table + "_" + event;
      const sql = trigger.get(table, name)?.sql || "";
      assert.match(sql, new RegExp("AFTER\\s+" + event + "\\s+ON\\s+" + table + "\\b", "i"), name);
      if (event !== "insert") checkColumns(sql, name, columns);
    }
  }
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  console.log(
    "Verified " +
      files.length +
      " migrations and recovery triggers for " +
      tables.length +
      " tables",
  );
} finally {
  db.close();
}
