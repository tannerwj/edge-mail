import { ulid } from "ulid";
import { type Bindings, Problem } from "../env";
import { type User, writable } from "./access";
import { type Credential } from "../agents/grants";
import { liveWrite, guard } from "../agents/audit";
import { changed } from "../live";

export const timerOperations = ["thread_mute", "thread_snooze", "thread_follow_up"];
type Who = { user: User; credential?: Credential };
type Data = Record<string, unknown>;
const undoColumns = ["muted", "snoozed_until", "follow_up_at", "if_no_reply", "follow_ready"];
function when(at: unknown) {
  if (at === null) return null;
  const n = typeof at === "string" ? Date.parse(at) : at;
  if (
    typeof n !== "number" ||
    !Number.isSafeInteger(n) ||
    n <= Date.now() ||
    n > Date.now() + 366 * 86400000
  )
    throw new Problem(400, "Choose a future time within one year");
  return n;
}
function timerUpdate(op: string, a: Data) {
  if (op === "thread_mute" && typeof a.muted === "boolean")
    return { sql: "muted=?", args: [Number(a.muted)] };
  if (op === "thread_snooze") return { sql: "snoozed_until=?", args: [when(a.at)] };
  if (op === "thread_follow_up")
    return {
      sql: "follow_up_at=?,if_no_reply=?,follow_ready=0",
      args: [when(a.at), Number(a.if_no_reply !== false)],
    };
  throw new Problem(400, "Choose a conversation action");
}
function snoozeGuard(op: string, a: Data) {
  const expected =
    typeof a.undo_revision === "string" && op === "thread_snooze" && a.at === null
      ? a.undo_revision
      : undefined;
  const fresh = a.list_snooze === true && op === "thread_snooze" && a.at !== null;
  const stateGuard = expected
    ? " AND EXISTS(SELECT 1 FROM thread_state s WHERE s.mailbox_id=thread_members.mailbox_id AND s.thread_id=thread_members.thread_id AND s.revision=?)"
    : fresh
      ? " AND NOT EXISTS(SELECT 1 FROM thread_state s WHERE s.mailbox_id=thread_members.mailbox_id AND s.thread_id=thread_members.thread_id AND s.snoozed_until>unixepoch()*1000)"
      : "";
  return { expected, fresh, stateGuard };
}
export async function setThreadState(
  env: Bindings,
  who: Who,
  box: string,
  op: string,
  a: Data,
  dry = false,
) {
  if (
    !Array.isArray(a.ids) ||
    !a.ids.length ||
    a.ids.length > 200 ||
    a.ids.some((id) => typeof id !== "string")
  )
    throw new Problem(400, "Select up to 200 conversations");
  const update = timerUpdate(op, a),
    ids = [...new Set(a.ids)],
    c = who.credential;
  if (!(await env.DB.prepare(writable).bind(who.user.id, box).first()))
    throw new Problem(403, "Mailbox editor required");
  const { fresh, expected, stateGuard } = snoozeGuard(op, a);
  const selection = `WITH eligible AS(SELECT DISTINCT thread_id FROM thread_members WHERE mailbox_id IN (${writable}) AND thread_id IN (SELECT value FROM json_each(?)) ${stateGuard} ${c ? "AND EXISTS(" + liveWrite + ")" : ""}),selected AS(SELECT thread_id FROM eligible WHERE (SELECT count(*) FROM eligible)=?) `;
  const params = [
    who.user.id,
    box,
    JSON.stringify(ids),
    ...(expected ? [expected] : []),
    ...(c ? guard(c, box) : []),
    ids.length,
  ];
  const sql = (s: string, ...values: (string | number | null)[]) =>
    env.DB.prepare(selection + s).bind(...params, ...values);
  const batch = [sql("SELECT count(*) n FROM selected")],
    rev = ulid();
  if (!dry) {
    if (c) {
      batch.push(
        sql(
          "INSERT INTO agent_audit SELECT ?,?,?,?,?,?,count(*) FROM selected HAVING count(*)>0",
          rev,
          c.grant,
          c.user.id,
          box,
          op,
          Date.now(),
        ),
      );
      batch.push(
        sql(
          "INSERT INTO timer_undo SELECT ?,v.thread_id,json_object('muted',coalesce(s.muted,0),'snoozed_until',s.snoozed_until,'follow_up_at',s.follow_up_at,'if_no_reply',coalesce(s.if_no_reply,1),'follow_ready',coalesce(s.follow_ready,0)),0 FROM selected v LEFT JOIN thread_state s ON s.mailbox_id=? AND s.thread_id=v.thread_id",
          rev,
          box,
        ),
      );
    }
    batch.push(
      sql(
        "INSERT OR IGNORE INTO thread_state(mailbox_id,thread_id,revision) SELECT ?,thread_id,? FROM selected",
        box,
        rev,
      ),
    );
    batch.push(
      sql(
        "UPDATE thread_state SET " +
          update.sql +
          ",revision=? WHERE mailbox_id=? AND thread_id IN(SELECT thread_id FROM selected)",
        ...update.args,
        rev,
        box,
      ),
    );
  }
  const [result] = await env.DB.batch<{ n: number }>(batch);
  if (result.results[0].n !== ids.length) throw new Problem(404, "Conversation unavailable");
  if (!dry) {
    if (op !== "thread_mute" && typeof update.args[0] === "number")
      await env.OUTBOX_CLOCK.getByName("conversation-reminders")
        .remind(update.args[0])
        .catch(() => console.warn('{"event":"reminder_alarm_deferred"}'));
    await changed(env, box);
  }
  return {
    matched: ids.length,
    ...(c && !dry ? { audit_id: rev } : {}),
    ...(fresh && !dry ? { revision: rev } : {}),
  };
}
export async function undoTimer(env: Bindings, who: Who, box: string, id: string, dry: boolean) {
  const c = who.credential,
    rev = ulid();
  const eligible =
    "FROM timer_undo u JOIN thread_state s ON s.thread_id=u.thread_id WHERE u.audit_id=? AND u.undone=0 AND s.revision=? AND s.mailbox_id IN (" +
    writable +
    ")" +
    (c ? " AND EXISTS(" + liveWrite + ")" : "");
  const args = [id, id, who.user.id, box, ...(c ? guard(c, box) : [])];
  const count =
    "(SELECT count(*) " +
    eligible +
    ")=(SELECT count(*) FROM timer_undo WHERE audit_id=? AND undone=0)";
  const check = env.DB.prepare(
    "SELECT " + count + " ok,(SELECT count(*) FROM timer_undo WHERE audit_id=? AND undone=0) n",
  ).bind(...args, id, id);
  const batch = [check];
  if (!dry) {
    batch.push(
      env.DB.prepare(
        "UPDATE timer_undo SET undone=2 WHERE audit_id=? AND undone=0 AND " + count,
      ).bind(id, ...args, id),
    );
    batch.push(
      env.DB.prepare(
        "UPDATE thread_state AS s SET " +
          undoColumns
            .map(
              (f) =>
                f +
                "=(SELECT json_extract(before_state,'$." +
                f +
                "') FROM timer_undo u WHERE u.audit_id=?1 AND u.thread_id=s.thread_id AND u.undone=2)",
            )
            .join(",") +
          ",revision=?2 WHERE mailbox_id=?3 AND thread_id IN (SELECT thread_id FROM timer_undo WHERE audit_id=?1 AND undone=2)",
      ).bind(id, rev, box),
    );
    batch.push(
      env.DB.prepare("UPDATE timer_undo SET undone=1 WHERE audit_id=? AND undone=2").bind(id),
    );
  }
  const [checkResult] = await env.DB.batch<{ ok: number; n: number }>(batch);
  const row = checkResult.results[0];
  if (!row.ok) throw new Problem(409, "The conversation reminder has changed");
  if (!dry) await changed(env, box);
  return { matched: row.n };
}
export async function wakeThreads(env: Bindings) {
  const now = Date.now(),
    revision = ulid();
  const changes = await env.DB.batch<{ mailbox_id: string }>([
    env.DB.prepare(
      "UPDATE thread_state SET snoozed_until=NULL,revision=? WHERE rowid IN(SELECT rowid FROM thread_state WHERE snoozed_until<=? LIMIT 100) RETURNING mailbox_id",
    ).bind(revision, now),
    env.DB.prepare(
      "UPDATE thread_state SET follow_ready=1,revision=? WHERE rowid IN(SELECT rowid FROM thread_state WHERE follow_up_at<=? AND follow_ready=0 LIMIT 100) RETURNING mailbox_id",
    ).bind(revision, now),
    env.DB.prepare(
      "DELETE FROM message_wakes WHERE rowid IN(SELECT rowid FROM message_wakes WHERE until<=? LIMIT 100) RETURNING mailbox_id",
    ).bind(now),
  ]);
  await Promise.all(
    [...new Set(changes.flatMap((r) => r.results.map((x) => x.mailbox_id)))].map((box) =>
      changed(env, box),
    ),
  );
}
