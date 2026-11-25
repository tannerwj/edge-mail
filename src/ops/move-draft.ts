import { createHash } from "node:crypto";
import { Problem, type Bindings } from "../env";
import { writable, type User } from "./access";
import { drafts, validateLetter } from "./drafts";
import { copyUploads } from "./compose-undo";

export async function moveDraft(
  env: Bindings,
  user: User,
  box: string,
  id: string,
  data: Record<string, unknown>,
) {
  const target = data.mailbox;
  if (typeof target !== "string" || target === box || !Number.isSafeInteger(data.revision))
    throw new Problem(400, "Choose another sending mailbox.");
  const revision = Number(data.revision);
  const key = createHash("sha256")
    .update(JSON.stringify([user.id, box, id, revision, target]))
    .digest("hex")
    .slice(0, 26)
    .toUpperCase();
  const owner = `actor=? AND mailbox_id IN (${writable})`;
  const args = [user.id, user.id, target];
  const active = env.DB.prepare(
    "SELECT id FROM drafts WHERE id=? AND " + owner + " AND discarded_until IS NULL",
  ).bind(key, ...args);
  if (await active.first()) return { id: key };
  const source = await drafts(env, user, box, id);
  if (!("content" in source) || source.revision !== revision)
    throw new Problem(409, "Draft changed in another session.");
  if (source.parent)
    throw new Problem(409, "Replies stay in the mailbox that received the message.");
  const letter = validateLetter(source.content);
  delete letter.from;
  // Keep an expiring owner record for uploaded files even when a transfer is interrupted.
  await env.DB.prepare(`INSERT INTO drafts(id,mailbox_id,actor,content,updated_at,discarded_until,revision)
    SELECT ?,b.id,?,?,?,?,-1 FROM (${writable}) b WHERE true ON CONFLICT DO NOTHING`)
    .bind(
      key,
      user.id,
      JSON.stringify(letter),
      new Date().toISOString(),
      Date.now() + 3_600_000,
      user.id,
      target,
    )
    .run();
  if (
    !(await env.DB.prepare(
      "SELECT id FROM drafts WHERE id=? AND " + owner + " AND discarded_until>?",
    )
      .bind(key, ...args, Date.now())
      .first())
  )
    throw new Problem(403, "Sending mailbox unavailable.");
  await copyUploads(env, box, id, key, letter.files || [], target);
  const sourceWhere = "id=? AND " + owner + " AND revision=? AND discarded_until IS NULL";
  const sourceArgs = [id, user.id, user.id, box, revision];
  const [moved] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE drafts SET discarded_until=NULL,revision=1 WHERE revision=-1 AND id=? AND " +
        owner +
        " AND discarded_until>? AND EXISTS(SELECT 1 FROM drafts WHERE " +
        sourceWhere +
        ")",
    ).bind(key, ...args, Date.now(), ...sourceArgs),
    env.DB.prepare(
      "UPDATE drafts SET revision=revision+1,discarded_until=0 WHERE changes()=1 AND " +
        sourceWhere,
    ).bind(...sourceArgs),
  ]);
  if (!moved.meta.changes && !(await active.first()))
    throw new Problem(409, "Draft changed in another session.");
  return { id: key };
}
