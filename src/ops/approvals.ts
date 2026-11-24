import { addDestination } from "../agents/destinations";
import { Problem, type Bindings } from "../env";
import { type User, writable } from "./access";
import { resolveGrant } from "../agents/grants";
import { pendingReview } from "../agents/review-request";
import { ruleChange } from "./rules";
import { changeHook } from "./webhooks";
import { unseal } from "../instance-key";
type Row = {
  id: string;
  kind: string;
  request: string | null;
  grant_id: string;
  audience: string;
  state: string;
  mailbox_id: string;
  reason: string;
};
export async function reviews(env: Bindings, user: User) {
  const rows = await env.DB.prepare(
    "SELECT r.id,r.kind,r.reason,r.mailbox_id,g.name,r.created,json_extract(o.letter,'$.to') recipients,json_extract(o.letter,'$.cc') cc,json_extract(o.letter,'$.bcc') bcc,json_extract(o.letter,'$.subject') subject,substr(json_extract(o.letter,'$.body'),1,200) snippet FROM agent_reviews r JOIN agent_grants g ON g.id=r.grant_id LEFT JOIN outbox o ON o.id=r.id AND o.actor=r.actor WHERE r.actor=? AND r.state='pending' AND EXISTS(" +
      writable.replace("b.id=?", "b.id=r.mailbox_id") +
      ") ORDER BY r.created,r.id LIMIT 100",
  )
    .bind(user.id, user.id)
    .all();
  return rows.results;
}
export async function reviewDetails(env: Bindings, user: User, id: string) {
  const row = await env.DB.prepare(
    "SELECT r.request,r.kind,o.letter FROM agent_reviews r LEFT JOIN outbox o ON o.id=r.id AND o.actor=r.actor WHERE r.id=? AND r.actor=? AND r.state='pending' AND EXISTS(" +
      writable.replace("b.id=?", "b.id=r.mailbox_id") +
      ")",
  )
    .bind(id, user.id, user.id)
    .first<{ request: string | null; kind: string; letter: string | null }>();
  if (!row) throw new Problem(404, "Approval request unavailable");
  if (row.letter) {
    const { from, to, cc, bcc, subject, body, files } = JSON.parse(row.letter);
    return {
      from,
      to,
      cc,
      bcc,
      subject,
      body,
      attachments: files?.map((f: { name: string }) => f.name),
    };
  }
  if (!row.request) throw new Problem(409, "Request unavailable");
  return JSON.parse(await unseal(env, "approval:" + id, JSON.parse(row.request)));
}
export async function decide(env: Bindings, user: User, id: string, approve: unknown) {
  if (typeof approve !== "boolean") throw new Problem(400, "Choose approve or decline");
  const row = await env.DB.prepare(
    "SELECT r.*,g.audience FROM agent_reviews r JOIN agent_grants g ON g.id=r.grant_id WHERE r.id=? AND r.actor=? AND EXISTS(" +
      writable.replace("b.id=?", "b.id=r.mailbox_id") +
      ")",
  )
    .bind(id, user.id, user.id)
    .first<Row>();
  if (!row) throw new Problem(404, "Approval request unavailable");
  if (row.state !== "pending") return { state: row.state };
  const box = row.mailbox_id;
  if (!approve) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE agent_reviews SET state='declined',decided_by=?,decided=?,request=NULL WHERE id=? AND state='pending'",
      ).bind(user.id, Date.now(), id),
      env.DB.prepare(
        "UPDATE outbox SET state='cancelled',error_code='approval_declined' WHERE id=? AND state='held' AND EXISTS(SELECT 1 FROM agent_reviews WHERE id=? AND state='declined')",
      ).bind(id, id),
    ]);
    return {
      state: await env.DB.prepare("SELECT state FROM agent_reviews WHERE id=?")
        .bind(id)
        .first<string>("state"),
    };
  }
  const c = await resolveGrant(env, row.grant_id, row.audience);
  if (row.kind === "send") {
    const job = await env.DB.prepare(
      "UPDATE agent_reviews SET state='approved',decided_by=?,decided=? WHERE id=? AND " +
        pendingReview +
        " AND EXISTS(SELECT 1 FROM outbox WHERE id=? AND state='held') RETURNING id",
    )
      .bind(user.id, Date.now(), id, id, user.id, c.grant, box, id)
      .first();
    if (!job) throw new Problem(409, "This send has already changed");
    const due = await env.DB.prepare("SELECT due_ms FROM outbox WHERE id=?")
      .bind(id)
      .first<number>("due_ms");
    await env.OUTBOX_CLOCK.getByName(id)
      .schedule(id, Math.max(due ?? 0, Date.now()))
      .catch(() => console.warn('{"event":"outbox_alarm_deferred"}'));
    return { state: "approved" };
  }
  if (!row.request) throw new Problem(409, "Request unavailable");
  const data = JSON.parse(await unseal(env, "approval:" + id, JSON.parse(row.request)));
  if (row.kind === "destination") return addDestination(env, c, box, data.address, false, id);
  if (row.kind === "rule")
    return ruleChange(env, user, box, data.id ?? undefined, data.edit, {
      credential: c,
      review: id,
    });
  if (row.kind === "webhook")
    return changeHook(env, { user, credential: c, review: id }, box, "create", data);
  throw new Problem(400, "Unknown review kind");
}
