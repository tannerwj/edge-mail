import { ulid } from "ulid";
import { guard, liveWrite } from "../agents/audit";
import type { Credential } from "../agents/grants";
import { fileSchema, type DraftFile } from "./compose-files";
import * as z from "zod/mini";
import { Problem, type Bindings, type Principal } from "../env";
import { human, writable } from "./access";

export type Letter = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  files?: DraftFile[];
  from?: string;
  include_signature?: boolean;
  rich?: boolean;
};
const blank: Letter = { to: "", cc: "", bcc: "", subject: "", body: "" };
const header = z.string().check(z.maxLength(4096), z.regex(/^[^\r\n\0]*$/));
const letterSchema = z.object({
  to: header,
  cc: header,
  bcc: header,
  subject: header,
  from: z.optional(header),
  include_signature: z.optional(z.boolean()),
  rich: z.optional(z.boolean()),
  files: z.optional(z.array(fileSchema).check(z.maxLength(32))),
  body: z.string().check(z.maxLength(130000)),
});
export function validateLetter(value: unknown): Letter {
  const parsed = letterSchema.safeParse(value);
  if (!parsed.success) throw new Problem(400, "Invalid draft field");
  return parsed.data;
}
function draftId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value))
    throw new Problem(400, "Invalid draft ID");
  return value;
}
type Row = {
  id: string;
  content: string;
  revision: number;
  parent: string | null;
  updated_at: string;
};
const scoped = ` FROM drafts WHERE discarded_until IS NULL AND actor=? AND mailbox_id IN (${writable})`;
const who = (p: Principal, box: string) => [human(p).id, human(p).id, box];
export async function drafts(env: Bindings, p: Principal, box: string, id?: string) {
  const select = "SELECT id,revision,parent,updated_at,";
  if (id) {
    const row = await env.DB.prepare(select + "content" + scoped + " AND id=?")
      .bind(...who(p, box), draftId(id))
      .first<Row>();
    if (!row) throw new Problem(404, "Draft unavailable");
    return { ...row, content: validateLetter(JSON.parse(row.content)) };
  }
  const rows = await env.DB.prepare(
    select +
      "json_extract(content,'$.subject') AS subject, coalesce(json_extract(content,'$.to'),'') AS recipient" +
      scoped +
      " ORDER BY updated_at DESC,id DESC LIMIT 100",
  )
    .bind(...who(p, box))
    .all();
  return { drafts: rows.results };
}
export async function initialLetter(
  env: Bindings,
  box: string,
  parent: string,
  mode: unknown,
): Promise<Letter> {
  const row =
    await env.DB.prepare(`SELECT m.sender,m.subject,m.body_key,md.recipients,md.cc,h.reply_to FROM messages m LEFT JOIN reply_headers h ON h.message_id=m.id
    LEFT JOIN message_metadata md ON md.message_id=m.id WHERE m.mailbox_id=? AND m.id=?`)
      .bind(box, parent)
      .first<{
        reply_to: string;
        sender: string;
        subject: string;
        body_key: string;
        recipients: string;
        cc: string;
      }>();
  if (!row) throw new Problem(404, "Original message unavailable");
  if (mode !== "reply" && mode !== "reply-all" && mode !== "forward")
    throw new Problem(400, "Invalid draft mode");
  if (mode === "forward") {
    const obj = await env.MAIL.get(row.body_key);
    if (!obj) throw new Problem(503, "Original message body unavailable");
    return {
      ...blank,
      subject: "Fwd: " + row.subject,
      body:
        "\n\n---------- Forwarded message ----------\nFrom: " +
        row.sender +
        "\nSubject: " +
        row.subject +
        "\n\n" +
        (await obj.text()).slice(0, 120000),
    };
  }
  const aliases = await env.DB.prepare("SELECT canonical FROM addresses WHERE mailbox_id=?")
    .bind(box)
    .all<{ canonical: string }>();
  const omit = new Set(aliases.results.map((r) => r.canonical));
  const recipients = (line: string) =>
    line
      .split("\n")
      .filter((v) => {
        const key = v.toLowerCase();
        if (!v || omit.has(key)) return false;
        omit.add(key);
        return true;
      })
      .join(", ");
  const to = recipients(row.reply_to || row.sender),
    cc =
      mode === "reply-all" ? recipients([row.recipients, row.cc].filter(Boolean).join("\n")) : "";
  return {
    ...blank,
    to,
    cc,
    subject: /^re:/i.test(row.subject) ? row.subject : "Re: " + row.subject,
  };
}
type DraftGrant = { credential: Credential; op: string };
function grantScope(agent?: DraftGrant) {
  return agent ? " AND EXISTS(" + liveWrite + ")" : "";
}
async function writeDraft(
  env: Bindings,
  stmt: D1PreparedStatement,
  box: string,
  agent?: DraftGrant,
) {
  const audit = agent
    ? [
        env.DB.prepare("INSERT INTO agent_audit SELECT ?,?,?,?,?,?,1 WHERE changes()=1").bind(
          ulid(),
          agent.credential.grant,
          agent.credential.user.id,
          box,
          agent.op,
          Date.now(),
        ),
      ]
    : [];
  const [result] = await env.DB.batch<Row>([stmt, ...audit]);
  return result.results[0];
}
export async function saveDraft(
  env: Bindings,
  p: Principal,
  box: string,
  id: string | undefined,
  input: Record<string, unknown>,
  agent?: DraftGrant,
) {
  const actor = human(p).id,
    key = draftId(id || input.id);
  if (!(await env.DB.prepare(writable).bind(actor, box).first()))
    throw new Problem(403, "Mailbox editor required");
  if (!id) {
    const parent = input.parent ? draftId(input.parent) : null,
      base = parent ? await initialLetter(env, box, parent, input.mode) : blank,
      content = input.content ? validateLetter(input.content) : base;
    const create = env.DB.prepare(
      `INSERT INTO drafts(id,mailbox_id,actor,content,updated_at,parent) SELECT ?,b.id,?,?,?,? FROM (${writable}) b WHERE NOT EXISTS(SELECT 1 FROM outbox WHERE id=?) ${grantScope(agent)} ON CONFLICT DO NOTHING`,
    ).bind(
      key,
      actor,
      JSON.stringify(content),
      new Date().toISOString(),
      input.mode === "forward" ? null : parent,
      actor,
      box,
      key,
      ...(agent ? guard(agent.credential, box) : []),
    );
    await writeDraft(env, create, box, agent);
    return drafts(env, p, box, key);
  }
  const revision = input.revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1)
    throw new Problem(400, "Missing draft revision");
  const content = JSON.stringify(validateLetter(input.content));
  const update = env.DB.prepare(
    "UPDATE drafts SET content=?,revision=revision+1,updated_at=? WHERE id IN (SELECT id" +
      scoped +
      " AND id=? AND revision=?)" +
      grantScope(agent) +
      " RETURNING id,revision,updated_at,parent,content",
  ).bind(
    content,
    new Date().toISOString(),
    ...who(p, box),
    key,
    revision,
    ...(agent ? guard(agent.credential, box) : []),
  );
  const result = await writeDraft(env, update, box, agent);
  if (result) return { ...result, content: validateLetter(JSON.parse(result.content)) };
  const current = await env.DB.prepare(
    "SELECT id,revision,updated_at,parent,content" + scoped + " AND id=?",
  )
    .bind(...who(p, box), key)
    .first<Row>();
  if (!current) throw new Problem(404, "Draft unavailable");
  if (current.content !== content)
    throw new Problem(409, "Draft changed in another session. Reopen it before saving.");
  return { ...current, content: validateLetter(JSON.parse(current.content)) };
}
