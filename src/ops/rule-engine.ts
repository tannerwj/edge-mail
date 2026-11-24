import { queueRuleNotice } from "./rule-notifications";
import { queueReply } from "./reply-through";
import { indexText } from "../index-text";
import { ruleAllowed } from "../agents/delegation";
import { vacationReply } from "./vacation";
import { screenArrival } from "./screening";
import { createHash } from "node:crypto";
import { queuedResend } from "./resend";
import { compileCondition, type Facts } from "../rule-matcher";
import { type Bindings } from "../env";
import {
  effective,
  authorized,
  latest,
  definition,
  type Definition,
  type Rule,
} from "./rule-definitions";
import type { Receipt } from "./receipt";
import { addressParser, type Email } from "postal-mime";

const recipients = (list: Email["to"]) =>
  (list || []).flatMap((v) => (v.group ? v.group.map((a) => a.address || "") : [v.address || ""]));

function replyAuthor(mail: Email) {
  const headers = mail.headers.filter((h) => h.key === "from");
  if (headers.length !== 1) return [];
  const authors = addressParser(headers[0].value);
  return authors.length === 1 && authors[0].address ? [authors[0].address.toLowerCase()] : [];
}
export function mailFacts(mail: Email, meta: Receipt, body: string, size: number): Facts {
  const sender = mail.from?.address || meta.from;
  const digest = createHash("sha256")
    .update(JSON.stringify([sender, mail.subject || ""]))
    .update(body);
  for (const part of mail.attachments) {
    const data = part.content instanceof ArrayBuffer ? new Uint8Array(part.content) : part.content;
    digest.update(JSON.stringify([part.filename, part.mimeType])).update(data);
  }
  const facts: Facts = {
    envelope_from: [meta.from],
    parsed_digest: [digest.digest("hex")],
    from: [sender],
    reply_author: meta.kind === "reply-through" ? replyAuthor(mail) : [],
    sender_domain: [sender.split("@").at(-1) || ""],
    to: recipients(mail.to),
    cc: recipients(mail.cc),
    delivered_to: [meta.to],
    alias: [meta.matched],
    plus_tag: [meta.tag || ""],
    subject: [mail.subject || ""],
    body: [indexText(body)],
    list_id: [],
    has_attachment: [String(mail.attachments.length > 0)],
    attachment_type: mail.attachments.map((a) => a.mimeType),
    size: [String(size)],
    spf: [meta.auth.spf || ""],
    dkim: [meta.auth.dkim || ""],
    dmarc: [meta.auth.dmarc || ""],
    direction: ["inbound"],
  };
  for (const h of mail.headers.slice(0, 256)) {
    const key = "header:" + h.key.toLowerCase();
    (facts[key] ??= []).push(h.value.slice(0, 4096));
  }
  facts.list_id = facts["header:list-id"] || [];
  return facts;
}
export function ruleActions(
  env: Bindings,
  box: string,
  id: string,
  v: Rule,
  actions: Definition["actions"],
) {
  const execution = crypto.randomUUID();
  const stmts = [
    env.DB.prepare(`INSERT INTO rule_runs(execution_id,rule_id,revision,mailbox_id,message_id,actions)
    SELECT ?,v.rule_id,v.revision,m.mailbox_id,m.id,? FROM messages m JOIN rule_versions v ON v.rule_id=? AND v.revision=?
    WHERE m.id=? AND m.mailbox_id=? AND ${latest} AND ${authorized} AND ${ruleAllowed} ON CONFLICT DO NOTHING`).bind(
      execution,
      JSON.stringify(actions),
      v.rule_id,
      v.revision,
      id,
      box,
    ),
  ];
  const run =
    "EXISTS(SELECT 1 FROM rule_runs WHERE message_id=? AND rule_id=? AND revision=? AND execution_id=?)";
  const guard = [id, v.rule_id, v.revision, execution];
  for (const a of actions) {
    if (a.kind === "forward" || a.kind === "auto_reply") continue;
    if ("target" in a) {
      stmts.push(
        queueRuleNotice(env, a, box, { id, rule: v.rule_id, execution }, { sql: run, args: guard }),
      );
      continue;
    }
    if (a.kind === "snooze") {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO message_wakes(message_id,mailbox_id,until) SELECT ?,?,? WHERE ${run} ON CONFLICT(message_id) DO UPDATE SET until=max(until,excluded.until)`,
        ).bind(id, box, Date.now() + a.minutes * 60000, ...guard),
      );
      continue;
    }
    if (a.kind === "label") {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO message_labels SELECT ?,?,? WHERE ${run} ON CONFLICT DO NOTHING`,
        ).bind(box, id, a.value, ...guard),
      );
    } else {
      const updates: Record<string, string> = {
        star: "starred=1",
        mark_read: "is_read=1",
        archive: "folder='archive'",
        skip_inbox: "folder='archive'",
        spam: "folder='spam'",
        trash: "folder='trash'",
      };
      stmts.push(
        env.DB.prepare(`UPDATE messages SET ${updates[a.kind]} WHERE id=? AND ${run}`).bind(
          id,
          ...guard,
        ),
      );
    }
  }
  return stmts;
}
export async function arrivalActions(
  env: Bindings,
  meta: Receipt,
  id: string,
  facts: Facts,
  body: string,
) {
  const box = meta.mailbox;
  if (meta.kind === "reply-through") return queueReply(env, meta, id, facts, body);
  const rules = await env.DB.prepare(effective).bind(box).all<Rule>();
  const screening = await screenArrival(env, box, id, facts);
  const statements = screening.writes;
  if (screening.quarantine) return statements;
  for (const v of rules.results) {
    const doc = definition(JSON.parse(v.document));
    if (!compileCondition(doc.condition)(facts)) continue;
    statements.push(...ruleActions(env, box, id, v, doc.actions));
    for (const a of doc.actions)
      if (a.kind === "auto_reply")
        statements.push(...(await vacationReply(env, v, a, box, id, facts)));
      else if (a.kind === "forward" && a.mode === "resend")
        statements.push(...(await queuedResend(env, v, a, box, id, facts)));
    if (doc.stop) break;
  }
  return statements;
}
