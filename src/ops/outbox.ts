import { sendDecision } from "../agents/policies";
import { formatText } from "../rich-text";
import { chooseIdentity } from "./identities";
import { guard, liveWrite } from "../agents/audit";
import type { Credential } from "../agents/grants";
import { ulid } from "ulid";
import { storedFiles } from "./compose-files";
import { sentLayout } from "./sent-mime";
import { MAX_RAW } from "./receipt";
import { address } from "../address";
import { Problem, type Bindings, type Principal } from "../env";
import { human, writable } from "./access";
import type { Letter } from "./drafts";
export type Outgoing = Omit<Letter, "to" | "cc" | "bcc"> & {
  to: string[];
  cc: string[];
  bcc: string[];
  forwardedFrom?: string;
  replyAlias?: string;
  replyForward?: string;
  vacation?: boolean;
  html?: string;
};
export type Item = {
  id: string;
  actor: string;
  mailbox_id: string;
  provider: string;
  from_addr: string;
  reply_addr: string;
  letter: string;
  parent: string | null;
  attempts: number;
  created_at: string;
};
const summary =
  "id,state,(json_type(letter,'$.undo_source') IS NOT NULL OR EXISTS(SELECT 1 FROM drafts d WHERE d.id=json_extract(outbox.letter,'$.restore_draft') AND d.actor=outbox.actor AND d.mailbox_id=outbox.mailbox_id AND d.discarded_until IS NULL)) AS can_reopen,EXISTS(SELECT 1 FROM agent_reviews ar WHERE ar.id=outbox.id AND ar.state='pending') AS awaiting_approval,error_code,provider,provider_id,due_ms,attempts,created_at,json_extract(letter,'$.scheduledFor') AS scheduled_for,json_extract(letter,'$.subject') AS subject";
const scope = ` FROM outbox WHERE actor=? AND mailbox_id IN (${writable})`;
function destinations(raw: string, seen: Set<string>) {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((v) => address(v).canonical)
    .filter((v) => {
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    });
}
export async function outbox(env: Bindings, p: Principal, box: string, id?: string) {
  const actor = human(p).id;
  const select = "SELECT " + summary + scope,
    args = [actor, actor, box];
  if (!id || id === "scheduled") {
    const order = id
      ? " AND scheduled_for IS NOT NULL AND state IN ('held','deferred') ORDER BY due_ms"
      : " ORDER BY created_at DESC";
    const rows = await env.DB.prepare(select + order + " LIMIT 100")
      .bind(...args)
      .all();
    return { items: rows.results };
  }
  const row = await env.DB.prepare(select + " AND id=?")
    .bind(...args, id)
    .first();
  if (!row) throw new Problem(404, "Outbox item unavailable");
  return row;
}
export function provider(env: Bindings) {
  if (env.SEND_MODE === "cloudflare" && env.OUTBOUND && env.SEND_FROM && env.SEND_MAILBOX)
    return "cloudflare";
  if (env.SEND_MODE === "capture" || env.PROBE_MODE === "capture") return "capture";
  throw new Problem(503, "Sending has not been configured");
}
export function prepareLetter(content: string) {
  const source: Letter = JSON.parse(content),
    seen = new Set<string>();
  const letter: Outgoing = {
    ...source,
    to: destinations(source.to, seen),
    cc: destinations(source.cc, seen),
    bcc: destinations(source.bcc, seen),
  };
  if (!seen.size || seen.size > 50) throw new Problem(400, "Use between one and 50 recipients");
  if (!letter.subject.trim() || !letter.body.trim())
    throw new Problem(400, "Add a subject and message");
  return { letter, units: seen.size };
}
export function dispatchTime(now: number, data: Record<string, unknown>) {
  const delay = data.undoSeconds ?? 10;
  if (typeof delay !== "number" || !Number.isInteger(delay) || delay < 5 || delay > 30)
    throw new Problem(400, "Undo must be 5–30 seconds");
  const earliest = now + delay * 1000;
  const scheduled = data.scheduledFor;
  if (
    scheduled !== undefined &&
    (typeof scheduled !== "number" ||
      !Number.isSafeInteger(scheduled) ||
      scheduled < earliest ||
      !Number.isFinite(new Date(scheduled).getTime()))
  )
    throw new Problem(400, "Choose a send time after the undo window");
  return scheduled ?? earliest;
}
async function verifyAttachments(
  env: Bindings,
  box: string,
  id: string,
  from: string,
  reply: string,
  letter: Outgoing,
) {
  if (letter.files?.length) {
    const item = { id, from_addr: from, reply_addr: reply, created_at: new Date().toISOString() };
    const layout = sentLayout(item, letter, {});
    // Allow for the provider-generated transport headers and bounded reply references.
    if (layout.size + 4096 > MAX_RAW) throw new Problem(413, "The encoded message exceeds 25 MiB");
    await storedFiles(env, box, id, letter.files, false);
  }
}
async function prepareSubmission(
  env: Bindings,
  box: string,
  id: string,
  mailboxAddress: string,
  letter: Outgoing,
) {
  const mode = provider(env),
    reply = address(mailboxAddress).canonical;
  const { from, signature } = await chooseIdentity(env, box, reply, letter.from);
  if (signature && letter.include_signature !== false) letter.body += "\n\n-- \n" + signature;
  const formatted = formatText(letter.body, letter.rich === true, letter.files || []);
  letter.body = formatted.text;
  letter.html = formatted.html;
  await verifyAttachments(env, box, id, from, reply, letter);
  return { mode, reply, from };
}
export async function submitDraft(
  env: Bindings,
  p: Principal,
  box: string,
  id: string,
  data: Record<string, unknown>,
  agent?: { credential: Credential; op: string },
) {
  const actor = human(p).id,
    scopeArgs = [actor, actor, box];
  if (!(await env.DB.prepare(writable).bind(actor, box).first()))
    throw new Problem(403, "Mailbox editor required");
  const existing = await env.DB.prepare("SELECT " + summary + scope + " AND id=?")
    .bind(...scopeArgs, id)
    .first();
  if (existing) return existing;
  const draft = await env.DB.prepare(
    "SELECT d.content,d.parent,b.address,d.revision FROM drafts d JOIN mailboxes b ON b.id=d.mailbox_id WHERE d.discarded_until IS NULL AND d.id=? AND d.actor=? AND b.id=?",
  )
    .bind(id, actor, box)
    .first<{ content: string; parent: string | null; address: string; revision: number }>();
  if (!draft) return outbox(env, p, box, id);
  if (draft.revision !== data.revision)
    throw new Problem(409, "Reopen the current draft before sending");
  const { letter, units } = prepareLetter(draft.content);
  const { mode, reply, from } = await prepareSubmission(env, box, id, draft.address, letter);
  const now = Date.now(),
    due = dispatchTime(now, data);
  const review = agent
    ? await sendDecision(env, agent.credential.grant, box, [
        ...letter.to,
        ...letter.cc,
        ...letter.bcc,
      ])
    : null;
  if (data.dry_run === true)
    return { would_send: !review, would_hold: !!review, units, due_ms: due };
  const audit = ulid(),
    c = agent?.credential;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO outbox(id,mailbox_id,actor,provider,from_addr,reply_addr,letter,parent,units,state,due_ms,created_at)
      SELECT id,mailbox_id,actor,?,?,?,?,parent,?,'held',?,? FROM drafts WHERE discarded_until IS NULL AND id=? AND revision=? AND actor=? AND mailbox_id IN (${writable}) ${c ? "AND EXISTS(" + liveWrite + ")" : ""} ON CONFLICT DO NOTHING`).bind(
      mode,
      from,
      reply,
      JSON.stringify({
        ...letter,
        scheduledFor: data.scheduledFor,
        ...(!agent && data.reopen === true
          ? { restore_draft: ulid(), undo_source: JSON.parse(draft.content) }
          : {}),
        ...(c ? { agent_grant: c.grant, agent_origin: c.audience, agent_audit: audit } : {}),
      }),
      units,
      due,
      new Date(now).toISOString(),
      id,
      draft.revision,
      ...scopeArgs,
      ...(c ? guard(c, box) : []),
    ),
    ...(c && agent
      ? [
          env.DB.prepare(
            "INSERT INTO agent_audit SELECT ?,?,actor,mailbox_id,?,?,1 FROM outbox WHERE id=? AND json_extract(letter,'$.agent_audit')=?",
          ).bind(audit, c.grant, agent.op, now, id, audit),
        ]
      : []),
    env.DB.prepare(
      "DELETE FROM drafts WHERE id=? AND actor=? AND mailbox_id=? AND EXISTS(SELECT 1 FROM outbox o WHERE o.id=drafts.id AND o.actor=drafts.actor AND o.mailbox_id=drafts.mailbox_id)",
    ).bind(id, actor, box),
  ]);
  const item = await outbox(env, p, box, id);
  // A committed item survives a failed alarm registration. The cron uses the same claim.
  if (!review)
    await env.OUTBOX_CLOCK.getByName(id)
      .schedule(id, due)
      .catch(() => console.warn('{"event":"outbox_alarm_deferred"}'));
  return item;
}
export async function cancelSend(env: Bindings, p: Principal, box: string, id: string) {
  const actor = human(p).id;
  const row = await env.DB.prepare(
    "UPDATE outbox SET state='cancelled' WHERE id IN (SELECT id" +
      scope +
      " AND id=?) AND state IN ('held','deferred','cancelled') RETURNING id,state",
  )
    .bind(actor, actor, box, id)
    .first();
  if (!row) throw new Problem(409, "Undo has ended or this item is unavailable");
  return row;
}
