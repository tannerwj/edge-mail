import { createHmac, timingSafeEqual } from "node:crypto";
import { Problem, type Bindings } from "../env";
import { type User, writableMailboxes } from "./access";
import { triageAction } from "./triage";
import { changed } from "../live";

type Before = { id: string; mailbox_id: string; folder: string; is_read: number };
type Undo = {
  actor: string;
  expires: number;
  field: "folder" | "is_read";
  value: string | number;
  rows: [string, string | number][];
};
function sign(env: Bindings, payload: string) {
  return createHmac("sha256", env.SETUP_TOKEN)
    .update("workspace-triage-v1\n" + payload)
    .digest("base64url");
}
function receipt(env: Bindings, user: User, raw: unknown): Undo {
  if (typeof raw !== "string") throw new Problem(400, "Invalid Undo receipt");
  const offset = raw.indexOf("."),
    payload = raw.slice(offset + 1),
    mac = raw.slice(0, offset);
  const expected = sign(env, payload);
  if (
    mac.length !== expected.length ||
    !/^[A-Za-z0-9_-]+$/.test(mac) ||
    !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
  )
    throw new Problem(400, "Invalid Undo receipt");
  const parsed: Undo = JSON.parse(payload);
  if (parsed.actor !== user.id || parsed.expires < Date.now())
    throw new Problem(409, "Undo has expired");
  return parsed;
}
export async function workspaceTriage(env: Bindings, user: User, data: Record<string, unknown>) {
  const undo = data.undo ? receipt(env, user, data.undo) : undefined;
  const ids = undo ? undo.rows.map((r) => r[0]) : data.ids;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 200 ||
    ids.some((id) => typeof id !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))
  )
    throw new Problem(400, "Select between one and 200 messages.");
  const selected = [...new Set(ids)];
  const base = `WITH eligible AS MATERIALIZED (SELECT m.id,m.mailbox_id,m.folder,m.is_read FROM messages m JOIN json_each(?) input ON input.value=m.id WHERE m.mailbox_id IN (${writableMailboxes})`;
  const args: (string | number)[] = [JSON.stringify(selected), user.id];
  if (undo) args.push(undo.value);
  const scope =
    base +
    (undo ? " AND m." + undo.field + "=?" : "") +
    "), selected AS MATERIALIZED (SELECT * FROM eligible WHERE (SELECT COUNT(*) FROM eligible)=?) ";
  args.push(selected.length);
  const action = undo
    ? {
        sql: `UPDATE messages SET ${undo.field}=(SELECT value->>1 FROM json_each(?) WHERE value->>0=messages.id) WHERE id IN (SELECT id FROM selected)`,
        value: JSON.stringify(undo.rows),
      }
    : triageAction(data);
  const [before] = await env.DB.batch<Before>([
    env.DB.prepare(scope + "SELECT * FROM selected").bind(...args),
    env.DB.prepare(scope + action.sql).bind(...args, action.value),
  ]);
  if (before.results.length !== selected.length)
    throw new Problem(409, "Selection changed. Refresh the list before trying again.");
  await Promise.all(
    [...new Set(before.results.map((r) => r.mailbox_id))].map((box) => changed(env, box)),
  );
  if (!undo && (data.field === "folder" || data.field === "is_read")) {
    const field = data.field;
    const payload = JSON.stringify({
      actor: user.id,
      expires: Date.now() + 30000,
      field,
      value: action.value,
      rows: before.results.map((r) => [r.id, r[field]]),
    } satisfies Undo);
    return { matched: selected.length, undo: sign(env, payload) + "." + payload };
  }
  return { matched: selected.length };
}
