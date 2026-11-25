import { Problem, type Bindings, type Principal } from "../env";
import { human, writable } from "./access";
import { draftFileKey, type DraftFile } from "./compose-files";
import type { Letter } from "./drafts";

const owner = `id=? AND actor=? AND mailbox_id IN (${writable})`;
export async function discardAction(
  env: Bindings,
  p: Principal,
  box: string,
  id: string,
  data: Record<string, unknown>,
) {
  if (!Number.isSafeInteger(data.revision) || Number(data.revision) < 1)
    throw new Problem(400, "Missing draft revision");
  const actor = human(p).id,
    args = [id, actor, actor, box],
    revision = Number(data.revision);
  const discard = data.action === "discard",
    now = Date.now();
  const until = discard ? now + 15000 : null;
  const [, existing] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE drafts SET discarded_until=?,revision=revision+1 WHERE " +
        owner +
        " AND revision=? AND " +
        (discard ? "discarded_until IS NULL" : "discarded_until>?"),
    ).bind(until, ...args, revision, ...(discard ? [] : [now])),
    env.DB.prepare(
      "SELECT id,revision,discarded_until FROM drafts WHERE " +
        owner +
        " AND revision=? AND " +
        (discard ? "discarded_until>?" : "discarded_until IS NULL"),
    ).bind(...args, revision + 1, ...(discard ? [now] : [])),
  ]);
  const row = existing.results[0];
  if (!row) throw new Problem(409, "Draft changed or Undo has expired");
  return row;
}
export async function sweepDiscardedDrafts(env: Bindings) {
  const rows = await env.DB.prepare(
    "UPDATE drafts SET discarded_until=0 WHERE id IN (SELECT id FROM drafts WHERE discarded_until<=? ORDER BY discarded_until LIMIT 16) RETURNING id,mailbox_id",
  )
    .bind(Date.now())
    .all<{ id: string; mailbox_id: string }>();
  for (const row of rows.results) {
    const objects = await env.MAIL.list({
      prefix: draftFileKey(row.mailbox_id, row.id, ""),
      limit: 100,
    });
    if (objects.objects.length) await env.MAIL.delete(objects.objects.map((v) => v.key));
    if (!objects.truncated)
      await env.DB.prepare("DELETE FROM drafts WHERE id=? AND discarded_until=0")
        .bind(row.id)
        .run();
  }
}
export async function copyUploads(
  env: Bindings,
  box: string,
  from: string,
  to: string,
  files: DraftFile[],
  target = box,
) {
  for (const file of files) {
    const key = draftFileKey(target, to, file.id);
    if (await env.MAIL.head(key)) continue;
    const obj = await env.MAIL.get(draftFileKey(box, from, file.id));
    if (!obj || obj.size !== file.size)
      throw new Problem(409, "Send cancelled. The original attachment is unavailable.");
    await env.MAIL.put(key, obj.body, { onlyIf: { etagDoesNotMatch: "*" } });
  }
}
export async function undoSubmission(env: Bindings, p: Principal, box: string, id: string) {
  const actor = human(p).id,
    args = [id, actor, actor, box];
  // Cancel first. An alarm that already claimed the item wins this race.
  const [, read] = await env.DB.batch<{ draft: string; source: string | null }>([
    env.DB.prepare(
      "UPDATE outbox SET state='cancelled',error_code='user_undo' WHERE " +
        owner +
        " AND state IN ('held','deferred') AND json_type(letter,'$.undo_source')='object'",
    ).bind(...args),
    env.DB.prepare(
      "SELECT json_extract(letter,'$.restore_draft') AS draft,json_extract(letter,'$.undo_source') AS source FROM outbox WHERE " +
        owner +
        " AND state='cancelled' AND error_code='user_undo'",
    ).bind(...args),
  ]);
  const row = read.results[0];
  if (typeof row?.draft !== "string")
    throw new Problem(409, "Undo has ended or this item is unavailable");
  if (typeof row.source === "string") {
    const content: Letter = JSON.parse(row.source);
    await copyUploads(env, box, id, row.draft, content.files || []);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO drafts(id,mailbox_id,actor,content,updated_at,parent) SELECT ?,mailbox_id,actor,json_extract(letter,'$.undo_source'),?,parent FROM outbox WHERE " +
          owner +
          " AND state='cancelled' AND error_code='user_undo' AND json_type(letter,'$.undo_source')='object' ON CONFLICT DO NOTHING",
      ).bind(row.draft, new Date().toISOString(), ...args),
      env.DB.prepare(
        "UPDATE outbox SET letter=json_remove(letter,'$.undo_source') WHERE " +
          owner +
          " AND error_code='user_undo' AND EXISTS(SELECT 1 FROM drafts WHERE id=? AND actor=outbox.actor AND mailbox_id=outbox.mailbox_id)",
      ).bind(...args, row.draft),
    ]);
  }
  const restored = await env.DB.prepare(
    "SELECT id FROM drafts WHERE " + owner + " AND discarded_until IS NULL",
  )
    .bind(row.draft, actor, actor, box)
    .first();
  if (!restored) throw new Problem(409, "The restored draft is no longer available");
  return restored;
}
