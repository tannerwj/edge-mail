import { setThreadState, timerOperations } from "../ops/thread-state";
import { type Bindings, Problem, requireValue } from "../env";
import type { Credential } from "./grants";
import { triage } from "../ops/triage";
export async function threadGet(env: Bindings, box: string, a: Record<string, unknown>) {
  const rows = (
    await env.DB.prepare(
      "SELECT m.id,m.subject,m.sender,m.snippet,m.received_at,m.folder,m.is_read FROM thread_members t JOIN messages m ON m.id=t.message_id WHERE t.mailbox_id=? AND t.thread_id=? AND m.id>? ORDER BY m.id LIMIT 51",
    )
      .bind(box, requireValue(a.id, 26), typeof a.after === "string" ? a.after : "")
      .all<{ id: string }>()
  ).results;
  return { messages: rows.slice(0, 50), next: rows.length > 50 ? rows[49].id : null };
}
export async function threadAction(
  env: Bindings,
  c: Credential,
  box: string,
  op: string,
  a: Record<string, unknown>,
  dry: boolean,
) {
  if (timerOperations.includes(op))
    return setThreadState(env, { user: c.user, credential: c }, box, op, a, dry);
  if (
    !Array.isArray(a.ids) ||
    !a.ids.length ||
    a.ids.length > 200 ||
    a.ids.some((x) => typeof x !== "string")
  )
    throw new Problem(400, "Select up to 200 conversations");
  const ids = [...new Set(a.ids)],
    rows = (
      await env.DB.prepare(
        "SELECT thread_id,message_id FROM thread_members WHERE mailbox_id=? AND thread_id IN (SELECT value FROM json_each(?)) LIMIT 201",
      )
        .bind(box, JSON.stringify(ids))
        .all<{ thread_id: string; message_id: string }>()
    ).results;
  if (rows.length > 200)
    throw new Problem(413, "Select conversations containing at most 200 messages");
  if (new Set(rows.map((x) => x.thread_id)).size !== ids.length)
    throw new Problem(404, "Conversation unavailable");
  const action =
    op === "thread_mark"
      ? { field: "is_read", value: a.read }
      : op === "thread_label"
        ? { field: a.remove === true ? "unlabel" : "label", value: a.label }
        : { field: "folder", value: op.slice(7) };
  return triage(
    env,
    c.user,
    box,
    rows.map((x) => x.message_id),
    { ...action, dry_run: dry },
    c,
  );
}
