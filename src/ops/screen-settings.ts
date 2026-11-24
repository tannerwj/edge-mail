import * as z from "zod/mini";
import { address, domainName } from "../address";
import { features } from "../spam-classifier";
import { type Bindings, type Principal, Problem } from "../env";
import { human, administrator, writable } from "./access";
import { owner } from "./destinations";
import { changed } from "../live";
const pref = z.object({
  screen_unknown: z.boolean(),
  learn: z.boolean(),
  quarantine_auth: z.boolean(),
});
export async function screenSettings(env: Bindings, p: Principal, box: string) {
  await owner(env, p, box);
  const [settings, list, pending] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM mailbox_screening WHERE mailbox_id=?").bind(box),
    env.DB.prepare(
      "SELECT scope_id,pattern,disposition FROM sender_list WHERE scope_id IN (?, '*') ORDER BY scope_id,pattern LIMIT 500",
    ).bind(box),
    env.DB.prepare(
      "SELECT m.sender,count(*) AS count,max(m.received_at) AS latest FROM mail_assessment a JOIN messages m ON m.id=a.message_id WHERE a.mailbox_id=? AND a.held=1 GROUP BY m.sender COLLATE NOCASE ORDER BY latest DESC LIMIT 100",
    ).bind(box),
  ]);
  return {
    settings: settings.results[0] || { screen_unknown: 0, learn: 0, quarantine_auth: 1 },
    list: list.results,
    pending: pending.results,
  };
}
async function updateSender(env: Bindings, p: Principal, box: string, d: Record<string, unknown>) {
  const scope = d.instance === true ? "*" : box;
  if (scope === "*") administrator(p);
  if (typeof d.pattern !== "string") throw new Problem(400, "Enter a sender address or domain");
  const exact = d.pattern.includes("@"),
    pattern = exact ? address(d.pattern).canonical : domainName(d.pattern);
  if (d.disposition === "remove") {
    await env.DB.prepare("DELETE FROM sender_list WHERE scope_id=? AND pattern=?")
      .bind(scope, pattern)
      .run();
    return;
  }
  if (d.disposition !== "allow" && d.disposition !== "block")
    throw new Problem(400, "Choose allow or block");
  const statements = [
    env.DB.prepare(
      "INSERT INTO sender_list VALUES(?,?,?) ON CONFLICT(scope_id,pattern) DO UPDATE SET disposition=excluded.disposition",
    ).bind(scope, pattern, d.disposition),
  ];
  // A mailbox owner's explicit decision releases only messages that are still being held.
  if (scope === box && exact) {
    const held =
      "SELECT a.message_id FROM mail_assessment a JOIN messages m ON m.id=a.message_id WHERE a.held=1 AND a.mailbox_id=? AND m.sender=? COLLATE NOCASE";
    if (d.disposition === "allow")
      statements.push(
        env.DB.prepare(
          "UPDATE messages SET folder='inbox' WHERE folder='spam' AND id IN(" + held + ")",
        ).bind(box, pattern),
      );
    statements.push(
      env.DB.prepare(
        "UPDATE mail_assessment SET held=0,reason=? WHERE message_id IN(" + held + ")",
      ).bind(d.disposition === "allow" ? "Sender approved" : "Sender blocked", box, pattern),
    );
  }
  await env.DB.batch(statements);
}
export async function changeScreen(
  env: Bindings,
  p: Principal,
  box: string,
  d: Record<string, unknown>,
) {
  await owner(env, p, box);
  if (d.action === "settings") {
    const v = pref.safeParse(d);
    if (!v.success) throw new Problem(400, "Choose screening preferences");
    await env.DB.prepare(
      "INSERT INTO mailbox_screening VALUES(?,?,?,?) ON CONFLICT(mailbox_id) DO UPDATE SET screen_unknown=excluded.screen_unknown,quarantine_auth=excluded.quarantine_auth,learn=excluded.learn",
    )
      .bind(
        box,
        Number(v.data.screen_unknown),
        Number(v.data.quarantine_auth),
        Number(v.data.learn),
      )
      .run();
  } else await updateSender(env, p, box, d);
  await changed(env, box);
  return { saved: true };
}
export async function trainMessage(
  env: Bindings,
  p: Principal,
  box: string,
  id: string,
  spam: unknown,
) {
  if (typeof spam !== "boolean") throw new Problem(400, "Choose spam or not spam");
  const actor = human(p).id;
  const where =
    "SELECT m.id FROM messages m WHERE m.id=? AND m.mailbox_id IN (" +
    writable +
    ") AND EXISTS(SELECT 1 FROM deliveries d WHERE d.message_id=m.id)";
  const row = await env.DB.prepare(
    "SELECT subject,sender,body_key FROM messages WHERE id IN(" + where + ")",
  )
    .bind(id, actor, box)
    .first<{ subject: string; sender: string; body_key: string }>();
  if (!row) throw new Problem(404, "Incoming message unavailable");
  const body = await env.MAIL.get(row.body_key, { range: { offset: 0, length: 8192 } });
  if (!body) throw new Problem(503, "Message text unavailable");
  const words = features(row.subject, await body.text(), row.sender);
  const bindings = [id, actor, box];
  await env.DB.batch([
    env.DB.prepare("DELETE FROM spam_samples WHERE message_id IN(" + where + ")").bind(...bindings),
    env.DB.prepare(
      "INSERT INTO spam_samples SELECT id,?,? FROM messages WHERE id IN(" + where + ")",
    ).bind(Number(spam), JSON.stringify(words), ...bindings),
    env.DB.prepare("UPDATE messages SET folder=? WHERE id IN(" + where + ")").bind(
      spam ? "spam" : "inbox",
      ...bindings,
    ),
    env.DB.prepare(
      "UPDATE mail_assessment SET held=0,reason=? WHERE message_id IN(" + where + ")",
    ).bind(spam ? "Marked spam" : "Marked not spam", ...bindings),
  ]);
  await changed(env, box);
  return { trained: true };
}
