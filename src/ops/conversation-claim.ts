import { Problem, type Bindings } from "../env";
import { writable, type User } from "./access";
import { changed } from "../live";

export const claimLabel = (alias: string) =>
  `(SELECT e.email FROM conversation_claims c JOIN user_emails e ON e.user_id=c.actor WHERE c.mailbox_id=${alias}.mailbox_id AND c.thread_id=${alias}.thread_id ORDER BY e.rowid LIMIT 1)`;

export async function conversationClaim(
  env: Bindings,
  user: User,
  box: string,
  thread: string,
  action: unknown,
) {
  if (action !== "claim" && action !== "release") throw new Problem(400, "Choose claim or release");
  const eligible = `SELECT DISTINCT mailbox_id,thread_id FROM thread_members WHERE mailbox_id IN (${writable}) AND thread_id=?`;
  const params = [user.id, box, thread];
  const update =
    action === "claim"
      ? env.DB.prepare(
          `INSERT INTO conversation_claims SELECT mailbox_id,thread_id,? FROM (${eligible}) WHERE 1 ON CONFLICT DO NOTHING`,
        ).bind(user.id, ...params)
      : env.DB.prepare(
          `DELETE FROM conversation_claims WHERE actor=? AND (mailbox_id,thread_id) IN (${eligible})`,
        ).bind(user.id, ...params);
  const [, check] = await env.DB.batch<{ actor: string | null }>([
    update,
    env.DB.prepare(
      `SELECT c.actor FROM (${eligible}) t LEFT JOIN conversation_claims c USING(mailbox_id,thread_id)`,
    ).bind(...params),
  ]);
  const row = check.results[0];
  if (!row) throw new Problem(403, "An editable conversation is required");
  if (row.actor && row.actor !== user.id)
    throw new Problem(409, "A colleague has claimed this conversation");
  await changed(env, box);
  return { claimed: !!row.actor };
}
