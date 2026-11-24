import assert from "node:assert/strict";
import { createHash } from "node:crypto";
export async function checkSnapshot({ start, json, sql, box, root, list }) {
  await start("box-editor@example.test", true);
  await json("/test/snapshot-finish");
  const id = "fixture-backup",
    prefix = "snapshots/" + id + "/";
  await json(list + "/" + root, { field: "label", value: "At backup" });
  sql("INSERT INTO snapshot_runs(id,created_at) VALUES('fixture-backup',CURRENT_TIMESTAMP)");
  await json("/test/snapshot-start");
  await json(list + "/" + root, { field: "unlabel", value: "At backup" });
  await json(list + "/" + root, { field: "label", value: "After backup" });
  for (
    let i = 0;
    i < 7 &&
    sql("SELECT phase FROM snapshot_runs WHERE id='fixture-backup'")[0].phase !== "complete";
    i++
  )
    await json("/test/snapshot-finish");
  const get = (key) => json("/test/snapshot-part?key=" + encodeURIComponent(key));
  const manifest = await get(prefix + "manifest.json");
  assert.ok(manifest.bookmark);
  assert.ok(manifest.parts.some((p) => p.key.includes("/instance_keys/")));
  assert.ok(manifest.parts.some((p) => p.key.includes("/delivery_events/")));
  assert.equal(manifest.id, id);
  const labels = [],
    objects = [];
  for (const part of manifest.parts) {
    const value = await get(part.key);
    assert.equal(createHash("sha256").update(JSON.stringify(value)).digest("hex"), part.digest);
    if (value.table === "instance_keys") {
      assert.ok(
        value.rows.some(
          (r) =>
            r.name === "content-signing-v1" && r.iv.length === 16 && r.ciphertext.length === 64,
        ),
      );
    }
    if (value.table === "message_labels") labels.push(...value.rows);
    if (value.objects) objects.push(...value.objects);
  }
  assert.ok(
    labels.some((r) => r.mailbox_id === box && r.message_id === root && r.label === "At backup"),
  );
  assert.ok(!labels.some((r) => r.label === "After backup"));
  assert.ok(
    objects.some(
      (o) => o.key.startsWith("raw/") && JSON.parse(o.customMetadata.receipt).mailbox === box,
    ),
  );
  assert.ok(objects.some((o) => o.key.startsWith("sent/") && o.key.endsWith(".envelope.json")));
  assert.ok(!manifest.tables.includes("search_fts"));
  console.log(
    "PASS · consistent snapshot under concurrent label changes, raw envelope inventory, private sent objects and part checksums",
  );
}
