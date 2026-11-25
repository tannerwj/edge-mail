import { ulid } from "ulid";
import type { Credential } from "../agents/grants";
import { guard, liveWrite, recordTriage } from "../agents/audit";
import { changed } from "../live";
import { Problem, requireValue, type Bindings, type Principal } from "../env";
import { human, writable } from "./access";

export function triageAction(data: Record<string, unknown>) {
  const { field, value } = data;
  if (field === "label" || field === "unlabel") {
    const label = requireValue(value, 80);
    return {
      sql:
        field === "label"
          ? "INSERT INTO message_labels SELECT mailbox_id,id,? FROM selected WHERE true ON CONFLICT DO NOTHING"
          : "DELETE FROM message_labels WHERE label=? AND message_id IN (SELECT id FROM selected)",
      value: label,
    };
  }
  if ((field === "starred" || field === "is_read") && typeof value === "boolean")
    return {
      sql: `UPDATE messages SET ${field}=? WHERE id IN (SELECT id FROM selected)`,
      value: Number(value),
    };
  if (
    field === "folder" &&
    typeof value === "string" &&
    ["inbox", "archive", "spam", "trash"].includes(value)
  )
    return { sql: "UPDATE messages SET folder=? WHERE id IN (SELECT id FROM selected)", value };
  throw new Problem(400, "Invalid message action");
}

export async function triage(
  env: Bindings,
  p: Principal,
  box: string,
  ids: unknown,
  data: Record<string, unknown>,
  credential?: Credential,
) {
  const actor = human(p).id;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 200 ||
    ids.some((id) => typeof id !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))
  )
    throw new Problem(400, "Select between one and 200 messages.");
  const unique = [...new Set(ids)];
  const args = [JSON.stringify(unique), actor, box, ...(credential ? guard(credential, box) : [])];
  const scope = `WITH eligible AS (
    SELECT m.id,m.mailbox_id FROM messages m JOIN json_each(?) input ON m.id=input.value
    WHERE m.mailbox_id IN (${writable}) ${credential ? "AND EXISTS(" + liveWrite + ")" : ""}
  )`;
  const { sql, value } = triageAction(data);
  // Both statements share a transaction. A missing or inaccessible ID prevents the whole change.
  const check = env.DB.prepare(
    scope + ` SELECT count(*) AS n, EXISTS(${writable}) AS allowed FROM eligible`,
  ).bind(...args, actor, box);
  const selected =
    scope + ", selected AS (SELECT * FROM eligible WHERE (SELECT count(*) FROM eligible)=?) ";
  const bindings = [...args, unique.length];
  const update = env.DB.prepare(selected + sql).bind(...bindings, value);
  const auditId = credential ? ulid() : undefined;
  const journal =
    credential && auditId
      ? recordTriage(env, credential, box, {
          selection: selected,
          args: bindings,
          field: data.field,
          value,
          id: auditId,
        })
      : [];
  const [count] = await env.DB.batch<{ n: number; allowed: number }>(
    data.dry_run === true ? [check] : [check, ...journal, update],
  );
  const row = count.results[0];
  if (!row.allowed) throw new Problem(403, "Mailbox editor required");
  if (row.n !== unique.length) throw new Problem(404, "Message unavailable");
  if (data.dry_run !== true) await changed(env, box);
  return {
    ok: true,
    matched: row.n,
    ...(auditId && data.dry_run !== true ? { audit_id: auditId } : {}),
  };
}
