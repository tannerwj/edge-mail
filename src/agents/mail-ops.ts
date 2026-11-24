import { writable } from "../ops/access";
import { sendDecision } from "./policies";
import { mailboxIdentities } from "../ops/identities";
import { referencedFiles } from "./uploads";
import { ulid } from "ulid";
import { type Bindings, Problem, requireValue } from "../env";
import { type Credential, digest } from "./grants";
import { validateLetter, initialLetter, saveDraft, drafts } from "../ops/drafts";
import { dispatchTime, submitDraft, prepareLetter, outbox, provider } from "../ops/outbox";
import { ruleChange, ruleDetail } from "../ops/rules";
type Args = Record<string, unknown>;
const blank = { to: "", cc: "", bcc: "", body: "", subject: "" };
const recipientLine = (v: unknown) =>
  Array.isArray(v) && v.every((s) => typeof s === "string") ? v.join(", ") : v;
async function content(env: Bindings, box: string, op: string, a: Args) {
  const mode =
    op === "mail_reply"
      ? a.reply_all === true
        ? "reply-all"
        : "reply"
      : op === "mail_forward"
        ? "forward"
        : null;
  const parent = mode ? requireValue(a.message, 26) : null;
  const base = parent ? await initialLetter(env, box, parent, mode) : blank;
  const line = (name: "to" | "cc" | "bcc") =>
    a[name] === undefined ? base[name] : recipientLine(a[name]);
  const body =
    mode === "forward"
      ? (typeof a.body === "string" ? a.body : "") + base.body
      : (a.body ?? base.body);
  return {
    parent,
    mode,
    letter: validateLetter({
      to: line("to"),
      cc: line("cc"),
      bcc: line("bcc"),
      subject: a.subject ?? base.subject,
      body,
      files: a.files,
      from: a.from,
      rich: a.rich,
      include_signature: a.include_signature,
    }),
  };
}
async function reserve(
  env: Bindings,
  c: Credential,
  box: string,
  job: { key: unknown; intent: string; draft?: string },
) {
  const key = requireValue(job.key, 160);
  const id = job.draft || ulid();
  await env.DB.prepare(
    "INSERT INTO agent_requests SELECT ?,?,?,?,? WHERE EXISTS(" +
      writable +
      ") ON CONFLICT DO NOTHING",
  )
    .bind(c.grant, box, key, job.intent, id, c.user.id, box)
    .run();
  const row = await env.DB.prepare(
    "SELECT digest,draft_id FROM agent_requests WHERE grant_id=? AND mailbox_id=? AND request_key=?",
  )
    .bind(c.grant, box, key)
    .first<{ digest: string; draft_id: string }>();
  if (!row) throw new Problem(403, "Mailbox editor required");
  if (row.digest !== job.intent)
    throw new Problem(409, "Idempotency key already used for a different request");
  return row.draft_id;
}
async function updateDraft(env: Bindings, c: Credential, box: string, a: Args, dry: boolean) {
  const agent = { credential: c, op: "draft_update" };
  const letter = validateLetter(a.content);
  if (dry) {
    const current = await drafts(env, c.user, box, requireValue(a.id, 26));
    if (!("revision" in current) || current.revision !== a.revision)
      throw new Problem(409, "Reopen the current draft before saving");
    return { would_update: a.id };
  }
  return saveDraft(
    env,
    c.user,
    box,
    requireValue(a.id, 26),
    {
      revision: a.revision,
      content: letter,
    },
    agent,
  );
}
async function sendExistingDraft(env: Bindings, c: Credential, box: string, a: Args, dry: boolean) {
  const op = "draft_send",
    key = requireValue(a.idempotency_key, 160),
    agent = { credential: c, op };
  const id = requireValue(a.id, 26);
  if (!dry)
    await reserve(env, c, box, {
      key,
      intent: digest(JSON.stringify([op, id, a.revision, a.scheduledFor])),
      draft: id,
    });
  return submitDraft(env, c.user, box, id, { ...a, dry_run: dry }, agent);
}
export async function writeMail(
  env: Bindings,
  c: Credential,
  box: string,
  op: string,
  a: Args,
  dry: boolean,
) {
  if (!(await env.DB.prepare(writable).bind(c.user.id, box).first()))
    throw new Problem(403, "Mailbox editor required");
  const agent = { credential: c, op };
  if (op === "draft_update") {
    return updateDraft(env, c, box, a, dry);
  }
  if (op === "draft_create") {
    const { letter, parent, mode } = await content(env, box, "mail_send", a);
    if (dry) return { would_create: true };
    return saveDraft(
      env,
      c.user,
      box,
      undefined,
      { id: ulid(), content: letter, parent, mode },
      agent,
    );
  }
  if (op === "draft_send") return sendExistingDraft(env, c, box, a, dry);
  const key = requireValue(a.idempotency_key, 160);
  const planned = await content(env, box, op, a);
  const { letter: outgoing, units } = prepareLetter(JSON.stringify(planned.letter));
  const when = dispatchTime(Date.now(), a);
  provider(env);
  if (dry) {
    const options = await mailboxIdentities(env, c.user, box);
    if (!options.some((i) => !planned.letter.from || i.from === planned.letter.from))
      throw new Problem(403, "Mailbox has no matching sending identity");
    if (a.attachments !== undefined) await referencedFiles(env, c, box, null, a.attachments);
    const hold = await sendDecision(env, c.grant, box, [
      ...outgoing.to,
      ...outgoing.cc,
      ...outgoing.bcc,
    ]);
    return { would_send: !hold, would_hold: !!hold, units, due_ms: when };
  }
  const id = await reserve(env, c, box, {
    key,
    intent: digest(
      JSON.stringify([
        op,
        planned,
        a.scheduledFor ?? null,
        ...(a.attachments === undefined ? [] : [a.attachments]),
      ]),
    ),
  });
  const prior = await env.DB.prepare("SELECT 1 FROM outbox WHERE id=? AND actor=? AND mailbox_id=?")
    .bind(id, c.user.id, box)
    .first();
  if (prior) return outbox(env, c.user, box, id);
  await sendDecision(env, c.grant, box, [...outgoing.to, ...outgoing.cc, ...outgoing.bcc]);
  if (a.attachments !== undefined)
    planned.letter.files = await referencedFiles(env, c, box, id, a.attachments);
  await saveDraft(env, c.user, box, undefined, {
    id,
    content: planned.letter,
    parent: planned.parent,
    mode: planned.mode,
  });
  return submitDraft(env, c.user, box, id, { ...a, revision: 1 }, agent);
}
export async function agentRule(
  env: Bindings,
  c: Credential,
  box: string,
  op: string,
  a: Args,
  dry: boolean,
) {
  const id = a.id === undefined ? undefined : requireValue(a.id, 26);
  if (op === "rule_history") return ruleDetail(env, c.user, box, requireValue(id, 26));
  if (a.action === "apply_existing")
    throw new Problem(400, "Apply changes to a selected batch with message_triage");
  const edit = {
    document: a.document,
    revision: a.revision ?? 0,
    scope: "mailbox",
    dry_run: dry || op === "rule_test",
    ...(op === "rule_delete" ? { enabled: false } : {}),
  };
  return ruleChange(env, c.user, box, id, edit, { credential: c });
}
