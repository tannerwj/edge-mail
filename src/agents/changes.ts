import { Problem, type Bindings } from "../env";
import { recheckCredential, type Credential } from "./grants";
import { mailboxAccess } from "../ops/access";
import { filterMessages } from "../ops/filter";
type Args = Record<string, unknown>;
type Stream = { epoch: string; floor: number; tail: number };
async function stream(env: Bindings) {
  const row = await env.DB.prepare(
    "SELECT epoch,floor,coalesce((SELECT max(seq) FROM changes),floor) tail FROM change_stream WHERE id=1",
  ).first<Stream>();
  if (!row) throw new Problem(503, "Change stream unavailable");
  return row;
}
function offset(state: Stream, cursor: unknown, initial: number) {
  if (cursor === undefined) return initial;
  const parts = typeof cursor === "string" ? cursor.split(".") : [];
  const seq = Number(parts[1]);
  if (
    parts.length !== 2 ||
    parts[0] !== state.epoch ||
    !/^\d+$/.test(parts[1]) ||
    !Number.isSafeInteger(seq) ||
    seq < state.floor ||
    seq > state.tail
  )
    throw new Problem(409, "Refresh the mailbox and start a new cursor");
  return seq;
}
const scope =
  "c.mailbox_id IN (SELECT b.id " +
  mailboxAccess +
  " AND (? IS NULL OR b.id=?) AND (? IS NULL OR b.id IN (SELECT value FROM json_each(?)))) AND (c.actor IS NULL OR c.actor=?)";
function args(c: Credential, box: string | null) {
  const boxes = c.boxes ? JSON.stringify(c.boxes) : null;
  return [c.user.id, box, box, boxes, boxes, c.user.id];
}
export async function changesSince(env: Bindings, c: Credential, box: string | null, a: Args) {
  const state = await stream(env),
    seq = offset(state, a.cursor, state.floor);
  const rows = (
    await env.DB.prepare(
      "SELECT c.seq,c.mailbox_id,c.entity,c.kind,c.at FROM changes c WHERE c.seq>? AND c.seq<=? AND " +
        scope +
        " ORDER BY c.seq LIMIT 101",
    )
      .bind(seq, state.tail, ...args(c, box))
      .all<{ seq: number }>()
  ).results;
  const more = rows.length > 100;
  return {
    changes: rows.slice(0, 100),
    more,
    cursor: state.epoch + "." + (more ? rows[99].seq : state.tail),
  };
}
export async function waitMessage(env: Bindings, c: Credential, box: string, a: Args) {
  const seconds = a.timeout ?? 25;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 25)
    throw new Problem(400, "Choose a timeout from 0 to 25 seconds");
  if (a.filter !== undefined && typeof a.filter !== "string")
    throw new Problem(400, "Use a mailbox search expression");
  const filter = filterMessages(new URLSearchParams({ q: a.filter ?? "", folder: "anywhere" }));
  const initial = await stream(env);
  let after = offset(initial, a.cursor, initial.tail);
  const socket = env.LIVE.getByName(box),
    deadline = Date.now() + seconds * 1000;
  for (;;) {
    const marker = await socket.revision();
    const fresh = await recheckCredential(env, c);
    if (
      (fresh.boxes && !fresh.boxes.includes(box)) ||
      !(await env.DB.prepare("SELECT b.id " + mailboxAccess + " AND b.id=?")
        .bind(fresh.user.id, box)
        .first())
    )
      throw new Problem(403, "Mailbox unavailable");
    const state = await stream(env);
    const hit = await env.DB.prepare(
      "SELECT c.seq,m.id,m.subject,m.sender FROM changes c JOIN messages m ON m.id=c.entity AND m.mailbox_id=c.mailbox_id LEFT JOIN message_metadata md ON md.message_id=m.id LEFT JOIN thread_members t ON t.message_id=m.id AND t.mailbox_id=m.mailbox_id WHERE c.kind='received' AND c.seq>? AND c.seq<=? AND c.mailbox_id=? AND " +
        scope +
        " AND " +
        filter.sql +
        " ORDER BY c.seq LIMIT 1",
    )
      .bind(after, state.tail, box, ...args(fresh, box), ...filter.params)
      .first<{ seq: number }>();
    if (hit || deadline <= Date.now())
      return { message: hit, cursor: state.epoch + "." + (hit?.seq ?? state.tail) };
    after = state.tail;
    await socket.waitAfter(marker, deadline - Date.now());
  }
}
export async function expireChanges(env: Bindings) {
  const cut = Date.now() - 30 * 86400000;
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE change_stream SET floor=max(floor,coalesce((SELECT max(seq) FROM (SELECT seq FROM changes WHERE at<? ORDER BY seq LIMIT 1000)),0)) WHERE id=1",
    ).bind(cut),
    env.DB.prepare("DELETE FROM changes WHERE seq<=(SELECT floor FROM change_stream WHERE id=1)"),
  ]);
}
