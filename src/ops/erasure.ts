import type { Bindings } from "../env";
import { Problem } from "../env";
import type { User } from "./access";
import { owner } from "./destinations";
import { changed } from "../live";
import {
  cleanupObjects,
  hideErased,
  indexMarker,
  markerKey,
  markerPrefix,
  validateMarker,
  type Erasure,
} from "../erasure-ledger";
async function receipt(env: Pick<Bindings, "DB">, box: string, id: string) {
  return env.DB.prepare(
    "SELECT e.id,e.at,e.hidden,(SELECT count(*) FROM erased_objects k WHERE k.box=e.box AND k.id=e.id AND done=0) AS pending FROM erasures e WHERE e.box=? AND e.id=?",
  )
    .bind(box, id)
    .first();
}
export async function eraseStored(env: Pick<Bindings, "DB" | "MAIL">, box: string, id: string) {
  const row = await env.DB.prepare("SELECT content_hash FROM messages WHERE mailbox_id=? AND id=?")
    .bind(box, id)
    .first<string>("content_hash");
  if (!row) {
    const result = await receipt(env, box, id);
    if (!result) throw new Problem(404, "Message unavailable");
    return result;
  }
  const key = markerKey(box, row);
  let marker = await env.MAIL.get(key);
  if (!marker) {
    const raws = await env.DB.prepare(
      "SELECT raw_key FROM deliveries WHERE mailbox_id=? AND message_id=? ORDER BY id",
    )
      .bind(box, id)
      .all<{ raw_key: string }>();
    const data: Erasure = {
      version: 1,
      id,
      box,
      hash: row,
      at: Date.now(),
      raw: raws.results.map((r) => r.raw_key),
    };
    validateMarker(data, key);
    await env.MAIL.put(key, JSON.stringify(data), { onlyIf: { etagDoesNotMatch: "*" } });
    marker = await env.MAIL.get(key);
  }
  if (!marker) throw new Problem(503, "Deletion receipt unavailable");
  await indexMarker(env.DB, validateMarker(await marker.json<Erasure>(), key));
  await hideErased(env, box, id);
  await cleanupObjects(env, box, id);
  return receipt(env, box, id);
}
async function erase(env: Bindings, box: string, id: string) {
  const result = await eraseStored(env, box, id);
  await changed(env, box);
  return result;
}
export async function eraseMessage(
  env: Bindings,
  user: User,
  box: string,
  id: string,
  confirm: unknown,
) {
  await owner(env, user, box);
  if (confirm !== id) throw new Problem(400, "Confirm the selected message");
  return erase(env, box, id);
}
export async function sweepErasures(env: Bindings) {
  const cursor = await env.DB.prepare("SELECT cursor FROM erase_scan WHERE id=1").first<string>(
    "cursor",
  );
  const page = await env.MAIL.list({ prefix: markerPrefix, cursor: cursor || undefined, limit: 8 });
  for (const entry of page.objects) {
    const m = await env.MAIL.get(entry.key);
    if (!m) throw Error("Durable erasure receipt missing");
    const record = validateMarker(await m.json<Erasure>(), entry.key);
    if (
      await env.DB.prepare("SELECT 1 FROM erasures WHERE box=? AND id=? AND hidden=1")
        .bind(record.box, record.id)
        .first()
    )
      continue;
    await indexMarker(env.DB, record);
    await hideErased(env, record.box, record.id);
  }
  await env.DB.prepare("UPDATE erase_scan SET cursor=? WHERE id=1 AND cursor IS ?")
    .bind(page.truncated ? page.cursor : null, cursor)
    .run();
  const old = await env.DB.prepare(
    "SELECT box,message_id FROM trash_retention WHERE since<=? ORDER BY since LIMIT 4",
  )
    .bind(Date.now() - 30 * 86400000)
    .all<{ box: string; message_id: string }>();
  for (const m of old.results) await erase(env, m.box, m.message_id);
  await cleanupObjects(env);
}

export async function erasureReceipts(env: Bindings, user: User, box: string, id?: string) {
  await owner(env, user, box);
  if (id) return receipt(env, box, id);
  return (
    await env.DB.prepare(
      "SELECT e.id,e.at,e.hidden,(SELECT count(*) FROM erased_objects k WHERE k.box=e.box AND k.id=e.id AND done=0) AS pending FROM erasures e WHERE e.box=? ORDER BY e.at DESC LIMIT 100",
    )
      .bind(box)
      .all()
  ).results;
}
