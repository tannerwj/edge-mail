import { writable } from "../ops/access";
import { type Bindings, Problem } from "../env";
import type { Credential } from "./grants";
import { chainSql } from "./grants";
import { writesOn } from "../ops/budgets";
import { changed } from "../live";

export const liveWrite =
  chainSql +
  ` SELECT 1 WHERE ${writesOn} AND EXISTS(SELECT 1 FROM ancestors WHERE parent IS NULL) AND NOT EXISTS(
 SELECT 1 FROM ancestors a WHERE revoked IS NOT NULL OR expires<=? OR actor!=? OR audience!=?
 OR NOT EXISTS(SELECT 1 FROM json_each(scopes) WHERE value IN ('admin','mail.write'))
 OR (boxes IS NOT NULL AND NOT EXISTS(SELECT 1 FROM json_each(boxes) WHERE value=?)))`;
export function guard(c: Credential, box: string) {
  return [c.grant, Date.now(), c.user.id, c.audience, box];
}
export function recordTriage(
  env: Bindings,
  c: Credential,
  box: string,
  audit: {
    selection: string;
    args: (string | number)[];
    field: unknown;
    value: string | number;
    id: string;
  },
) {
  const { selection, args, field, value, id } = audit;
  const label = field === "label" || field === "unlabel";
  const column = field === "folder" ? "folder" : field === "starred" ? "starred" : "is_read";
  const code = label ? "label:" + value : column;
  const before = label
    ? "EXISTS(SELECT 1 FROM message_labels l WHERE l.message_id=m.id AND l.label=?)"
    : "m." + column;
  const after = label ? Number(field === "label") : value;
  return [
    env.DB.prepare(
      selection +
        ` INSERT INTO agent_audit(id,grant_id,actor,mailbox_id,op,at,affected) SELECT ?,?,?,?,'message_triage',?,count(*) FROM selected HAVING count(*)>0`,
    ).bind(...args, id, c.grant, c.user.id, box, Date.now()),
    env.DB.prepare(
      selection +
        ` INSERT INTO triage_undo(audit_id,message_id,field,before_value,after_value) SELECT ?,m.id,?,${before},? FROM selected s JOIN messages m ON m.id=s.id`,
    ).bind(...args, id, code, ...(label ? [value] : []), String(after)),
  ];
}
export async function auditList(env: Bindings, c: Credential, box: string) {
  return (
    await env.DB.prepare(
      "SELECT id,op,at,affected,grant_id FROM agent_audit WHERE actor=? AND mailbox_id=? ORDER BY at DESC,id DESC LIMIT 100",
    )
      .bind(c.user.id, box)
      .all()
  ).results;
}
export async function undoTriage(
  env: Bindings,
  who: { actor: string; user: string; credential?: Credential },
  box: string,
  id: string,
  dry: boolean,
) {
  const c = who.credential;
  const base = `WITH entries AS (SELECT e.* FROM triage_undo e JOIN agent_audit a ON a.id=e.audit_id WHERE a.id=? AND a.actor=? AND a.mailbox_id IN (${writable})
 ${c ? "AND EXISTS(" + liveWrite + ")" : ""}), observed AS (SELECT e.*,CASE field WHEN 'folder' THEN m.folder WHEN 'is_read' THEN cast(m.is_read AS TEXT) WHEN 'starred' THEN cast(m.starred AS TEXT)
 ELSE cast(EXISTS(SELECT 1 FROM message_labels l WHERE l.message_id=m.id AND l.label=substr(field,7)) AS TEXT) END current
 FROM entries e LEFT JOIN messages m ON m.id=e.message_id AND m.mailbox_id=?),
 eligible AS (SELECT * FROM observed WHERE undone=0 AND NOT EXISTS(SELECT 1 FROM observed WHERE undone=0 AND current IS NOT CASE after_value WHEN '0.0' THEN '0' WHEN '1.0' THEN '1' ELSE after_value END))`;
  const args = [id, who.actor, who.user, box, ...(c ? guard(c, box) : []), box];
  const q = (sql: string) => env.DB.prepare(base + sql).bind(...args);
  const check = q(
    " SELECT count(*) AS total,coalesce(sum(undone),0) AS done,(SELECT count(*) FROM eligible) AS eligible FROM observed",
  );
  const statements = [check];
  if (!dry) {
    // Capture the eligible set once. Later writes change the state used by the conflict check.
    statements.push(
      q(
        " UPDATE triage_undo SET undone=2 WHERE audit_id IN (SELECT audit_id FROM eligible) AND undone=0",
      ),
    );
    const select = " FROM triage_undo WHERE audit_id=? AND undone=2";
    for (const field of ["folder", "starred", "is_read"])
      statements.push(
        env.DB.prepare(`UPDATE messages SET ${field}=(SELECT before_value ${select} AND message_id=messages.id)
  WHERE id IN(SELECT message_id ${select} AND field=?)`).bind(id, id, field),
      );
    statements.push(
      env.DB.prepare(
        `DELETE FROM message_labels WHERE (message_id,label) IN(SELECT message_id,substr(field,7) ${select} AND field LIKE 'label:%' AND before_value='0')`,
      ).bind(id),
      env.DB.prepare(
        `INSERT OR IGNORE INTO message_labels SELECT ?,message_id,substr(field,7) ${select} AND field LIKE 'label:%' AND before_value='1'`,
      ).bind(box, id),
      env.DB.prepare("UPDATE triage_undo SET undone=1 WHERE audit_id=? AND undone=2").bind(id),
    );
  }
  const [res] = await env.DB.batch<{ total: number; done: number; eligible: number }>(statements),
    row = res.results[0];
  if (!row.total) throw new Problem(404, "Audit entry unavailable");
  if (!row.eligible && row.done !== row.total)
    throw new Problem(409, "Later changes conflict with this undo");
  if (!dry && row.eligible) await changed(env, box);
  return { matched: row.eligible, alreadyUndone: row.done };
}
