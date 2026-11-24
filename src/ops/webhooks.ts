import { activeNotification } from "./rule-notifications";
import {
  pendingReview,
  finishReview,
  requireEgressApproval,
  propose,
} from "../agents/review-request";
import { randomBytes, createHmac } from "node:crypto";
import { ulid } from "ulid";
import { type Bindings, Problem } from "../env";
import { publicUrl, publicFetch } from "../public-fetch";
import { seal, unseal } from "../instance-key";
import { type User } from "./access";
import { owner, owning } from "./destinations";
import { writesOn } from "./budgets";
import { type Credential, resolveGrant, permits } from "../agents/grants";
import { guard, liveWrite } from "../agents/audit";
import { wakePush } from "./push";
import { changed } from "../live";

const topics = [
  "message.received",
  "message.sent",
  "message.delivery",
  "rule.matched",
  "approval.requested",
];
type Hook = {
  id: string;
  mailbox_id: string;
  actor: string;
  grant_id: string | null;
  endpoint: string;
  version: number;
  keydata: string;
  previous_key: string | null;
  previous_until: number | null;
  enabled: number;
};
export async function listHooks(env: Bindings, user: User, box: string) {
  await owner(env, user, box);
  const rows = await env.DB.prepare(
    "SELECT id,host,version,events,enabled,updated FROM webhooks WHERE mailbox_id=? ORDER BY updated DESC LIMIT 100",
  )
    .bind(box)
    .all();
  const deliveries = await env.DB.prepare(
    "SELECT j.id,j.hook,j.kind,j.created,j.tries,j.state,j.version FROM webhook_jobs j JOIN webhooks w ON w.id=j.hook WHERE w.mailbox_id=? ORDER BY j.created DESC LIMIT 50",
  )
    .bind(box)
    .all();
  return { hooks: rows.results, deliveries: deliveries.results };
}
type Actor = { user: User; credential?: Credential; review?: string };
type Change = { id: string; op: string; audit: string; now: number; box: string };
async function commit(env: Bindings, actor: Actor, run: Change, stmt: D1PreparedStatement) {
  const { credential: c } = actor;
  const batch = [stmt];
  if (c) {
    batch.push(
      env.DB.prepare(
        "INSERT INTO agent_audit SELECT ?,?,?,?, ?,?,1 FROM webhooks WHERE id=? AND audit_id=?",
      ).bind(run.audit, c.grant, c.user.id, run.box, run.op, run.now, run.id, run.audit),
    );
    batch.push(
      env.DB.prepare(
        "INSERT INTO egress_alerts(audit_id,mailbox_id,at) SELECT id,mailbox_id,at FROM agent_audit WHERE id=?",
      ).bind(run.audit),
    );
  }
  batch.push(...finishReview(env, actor.review, run.audit));
  const [write] = await env.DB.batch(batch);
  if (!write.meta.changes) throw new Problem(409, "Webhook changed or permission expired");
  await changed(env, run.box);
  if (c) await wakePush(env, run.audit);
}
function receiverUrl(value: unknown) {
  try {
    return publicUrl(String(value));
  } catch {
    throw new Problem(400, "Enter a public HTTPS URL");
  }
}
function eventList(events: unknown) {
  if (
    !Array.isArray(events) ||
    !events.length ||
    events.length > topics.length ||
    events.some((e) => !topics.includes(e))
  )
    throw new Problem(400, "Choose a supported event");
  return JSON.stringify([...new Set(events)]);
}
async function createHook(
  env: Bindings,
  actor: Actor,
  run: Change,
  args: Record<string, unknown>,
  dry: boolean,
  query: { scope: string; bindings: (string | number)[] },
) {
  const { id, box } = run,
    c = actor.credential,
    { scope, bindings } = query;
  const url = receiverUrl(args.url);
  const events = eventList(args.events);
  if (c && !actor.review && (await requireEgressApproval(env, c)))
    return propose(
      env,
      c,
      box,
      { kind: "webhook", args, description: "Deliver " + events + " to " + url.host },
      dry,
    );
  if (dry) return { would_create: true, host: url.host };
  const secret = randomBytes(32).toString("base64url");
  const endpoint = await seal(env, "hook-url:" + id, url.href),
    key = await seal(env, "hook-key:" + id + ":1", secret);
  const insert = env.DB.prepare(
    "INSERT INTO webhooks(id,mailbox_id,actor,grant_id,host,endpoint,events,version,keydata,updated,audit_id) SELECT ?,?,?,?,?,?,?,1,?,?,? WHERE " +
      scope +
      " AND (SELECT count(*) FROM webhooks WHERE mailbox_id=? AND enabled=1)<32" +
      (actor.review ? " AND " + pendingReview : ""),
  ).bind(
    id,
    box,
    actor.user.id,
    c?.grant ?? null,
    url.host,
    JSON.stringify(endpoint),
    events,
    JSON.stringify(key),
    run.now,
    run.audit,
    ...bindings,
    box,
    ...(actor.review && c ? [actor.review, actor.user.id, c.grant, box] : []),
  );
  await commit(env, actor, run, insert);
  return { id, version: 1, secret };
}
export async function changeHook(
  env: Bindings,
  actor: Actor,
  box: string,
  op: string,
  args: Record<string, unknown>,
  dry = false,
) {
  await owner(env, actor.user, box);
  const id = op === "create" ? (actor.review ?? ulid()) : String(args.id);
  const run = { id, box, now: Date.now(), audit: ulid(), op: "webhook_" + op },
    c = actor.credential;
  const scope = "EXISTS(" + owning + ")" + (c ? " AND EXISTS(" + liveWrite + ")" : "");
  const bindings = [actor.user.id, box, ...(c ? guard(c, box) : [])];
  if (op === "create") return createHook(env, actor, run, args, dry, { scope, bindings });
  const item = await env.DB.prepare(
    "SELECT id,version,enabled FROM webhooks WHERE mailbox_id=? AND id=?",
  )
    .bind(box, id)
    .first<Hook>();
  if (!item) throw new Problem(404, "Webhook unavailable");
  if (!["disable", "rotate"].includes(op)) throw new Problem(400, "Unknown webhook action");
  if (dry) return { matched: 1 };
  if (op === "disable" && !item.enabled) return { disabled: true };
  const where =
    " WHERE id=? AND mailbox_id=? AND enabled=1 AND version=? AND (? IS NULL OR audit_id=?) AND " +
    scope;
  const expected = typeof args.expectedAudit === "string" ? args.expectedAudit : null;
  const params = [id, box, item.version, expected, expected, ...bindings];
  if (op === "disable") {
    await commit(
      env,
      actor,
      run,
      env.DB.prepare("UPDATE webhooks SET enabled=0,updated=?,audit_id=?" + where).bind(
        run.now,
        run.audit,
        ...params,
      ),
    );
    return { disabled: true };
  }
  const secret = randomBytes(32).toString("base64url"),
    version = item.version + 1;
  const key = await seal(env, "hook-key:" + id + ":" + version, secret);
  await commit(
    env,
    actor,
    run,
    env.DB.prepare(
      "UPDATE webhooks SET version=?,keydata=?,previous_key=keydata,previous_until=?,updated=?,audit_id=?,grant_id=?,actor=?" +
        where,
    ).bind(
      version,
      JSON.stringify(key),
      run.now + 3600000,
      run.now,
      run.audit,
      c?.grant ?? null,
      actor.user.id,
      ...params,
    ),
  );
  return { id, version, secret };
}

type Job = {
  id: string;
  hook: string;
  resource: string;
  kind: string;
  detail: string | null;
  created: number;
  tries: number;
  version: number;
};
async function deliver(env: Bindings, job: Job) {
  const hook = await env.DB.prepare(
    "SELECT w.*,g.audience FROM webhooks w LEFT JOIN agent_grants g ON g.id=w.grant_id WHERE w.id=? AND w.enabled=1 AND (w.grant_id IS NULL OR " +
      writesOn +
      ") AND EXISTS(" +
      owning.replace("u.id=?", "u.id=w.actor").replace("b.id=?", "b.id=w.mailbox_id") +
      ")",
  )
    .bind(job.hook)
    .first<Hook & { audience: string }>();
  if (!hook) return { state: "cancelled", version: job.version };
  if (
    job.kind === "rule.matched" &&
    !(await activeNotification(env, hook.mailbox_id, job.detail || "", job.resource))
  )
    return { state: "cancelled", version: job.version };
  if (hook.grant_id) {
    const c = await resolveGrant(env, hook.grant_id, hook.audience);
    if (!permits(c.scopes, "mail.write") || (c.boxes && !c.boxes.includes(hook.mailbox_id)))
      return { state: "cancelled", version: job.version };
  }
  const old =
    job.version === hook.version - 1 &&
    hook.previous_key &&
    Number(hook.previous_until) > Date.now();
  const version = old ? job.version : hook.version;
  const secret = await unseal(
    env,
    "hook-key:" + hook.id + ":" + version,
    JSON.parse(old ? String(hook.previous_key) : hook.keydata),
  );
  const url = await unseal(env, "hook-url:" + hook.id, JSON.parse(hook.endpoint));
  const payload = JSON.stringify({
    id: job.id,
    event: job.kind,
    mailbox: hook.mailbox_id,
    resource: job.resource,
    detail: job.detail,
    created: job.created,
  });
  const at = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret)
    .update(at + "." + job.id + "." + payload)
    .digest("hex");
  await publicFetch(url, {
    body: payload,
    headers: {
      "Content-Type": "application/json",
      "Edge-Mail-Delivery": job.id,
      "Edge-Mail-Timestamp": at,
      "Edge-Mail-Key-Version": String(version),
      "Edge-Mail-Signature": "sha256=" + signature,
    },
    limit: 32768,
  });
  return { state: "delivered", version };
}
export async function flushHooks(env: Bindings) {
  const now = Date.now();
  const jobs = await env.DB.prepare(
    "UPDATE webhook_jobs SET tries=tries+1,due=? WHERE id IN(SELECT id FROM webhook_jobs WHERE state='pending' AND due<=? ORDER BY due LIMIT 4) RETURNING *",
  )
    .bind(now + 60000, now)
    .all<Job>();
  for (const job of jobs.results) {
    let state = "pending",
      version = job.version;
    try {
      ({ state, version } = await deliver(env, job));
    } catch (error) {
      if (error instanceof Problem && [401, 403].includes(error.status)) state = "cancelled";
      else if (job.tries >= 8) state = "failed";
    }
    await env.DB.prepare(
      "UPDATE webhook_jobs SET state=?,version=?,due=? WHERE id=? AND tries=? AND state='pending'",
    )
      .bind(
        state,
        version,
        Date.now() + Math.min(86400000, 60000 * 2 ** job.tries),
        job.id,
        job.tries,
      )
      .run();
  }
  await env.DB.prepare(
    "DELETE FROM webhook_jobs WHERE id IN (SELECT id FROM webhook_jobs WHERE state!='pending' AND created<? LIMIT 100)",
  )
    .bind(now - 30 * 86400000)
    .run();
}
