import { activeNotification } from "./rule-notifications";
import { visibleInbox } from "./thread-views";
import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import { createHash } from "node:crypto";
import * as z from "zod/mini";
import { type Bindings, Problem } from "../env";
import { type User, mailboxAccess } from "./access";
import { seal, unseal } from "../instance-key";
import { owning } from "./destinations";
const subscription = z.object({
  endpoint: z.string().check(z.maxLength(2048)),
  keys: z.object({
    auth: z.string().check(z.regex(/^[\w-]{22}$/)),
    p256dh: z.string().check(z.regex(/^[\w-]{87}$/)),
  }),
});
const vapidName = "web-push-v1";
type Sealed = { ciphertext: string; iv: string };
type Keys = { publicKey: string; privateKey: string };
async function vapid(env: Bindings): Promise<Keys> {
  const q = env.DB.prepare("SELECT ciphertext,iv FROM instance_keys WHERE name=?").bind(vapidName);
  let row = await q.first<Sealed>();
  if (!row) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    if (!("privateKey" in pair)) throw Error("VAPID key pair unavailable");
    const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    if (!(raw instanceof ArrayBuffer) || !("d" in jwk) || !jwk.d)
      throw Error("Could not export VAPID identity");
    const publicKey = Buffer.from(raw).toString("base64url"),
      privateKey = jwk.d;
    const value = await seal(env, vapidName, JSON.stringify({ publicKey, privateKey }));
    await env.DB.prepare(
      "INSERT INTO instance_keys(name,ciphertext,iv) VALUES(?,?,?) ON CONFLICT DO NOTHING",
    )
      .bind(vapidName, value.ciphertext, value.iv)
      .run();
    row = await q.first<Sealed>();
  }
  if (!row) throw new Problem(503, "Notification key unavailable");
  return JSON.parse(await unseal(env, vapidName, row));
}
function endpoint(value: string) {
  const url = URL.canParse(value) ? new URL(value) : null;
  if (
    !url ||
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !/^(fcm\.googleapis\.com|(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)*push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/.test(
      url.hostname,
    )
  )
    throw new Problem(400, "Choose a browser notification endpoint");
  return url.href;
}
const deviceId = (url: string) => createHash("sha256").update(url).digest("hex");
export async function pushSettings(env: Bindings, user: User) {
  const rows = await env.DB.prepare(
    "SELECT id,new_mail FROM push_devices WHERE actor=? ORDER BY last_used DESC",
  )
    .bind(user.id)
    .all();
  return { devices: rows.results, publicKey: (await vapid(env)).publicKey };
}
export async function changePush(
  env: Bindings,
  user: User,
  a: Record<string, unknown>,
  origin: string,
) {
  if (a.action === "remove") {
    if (typeof a.id !== "string") throw new Problem(400, "Choose a device");
    await env.DB.prepare("DELETE FROM push_devices WHERE actor=? AND id=?")
      .bind(user.id, a.id)
      .run();
    return { removed: true };
  }
  if (a.action !== "subscribe" || typeof a.new_mail !== "boolean")
    throw new Problem(400, "Choose notification preferences");
  const parsed = subscription.safeParse(a.subscription);
  if (!parsed.success) throw new Problem(400, "Invalid browser subscription");
  const sub = parsed.data,
    id = deviceId(endpoint(sub.endpoint));
  const encrypted = await seal(env, "push/" + id + "/" + user.id, JSON.stringify(sub));
  const result = await env.DB.batch([
    env.DB.prepare("DELETE FROM push_devices WHERE id=? AND actor!=?").bind(id, user.id),
    env.DB.prepare(
      "INSERT INTO push_devices SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM push_devices WHERE actor=?)<10 OR EXISTS(SELECT 1 FROM push_devices WHERE id=? AND actor=?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,new_mail=excluded.new_mail,last_used=excluded.last_used",
    ).bind(
      id,
      user.id,
      encrypted.ciphertext,
      encrypted.iv,
      origin,
      Number(a.new_mail),
      Date.now(),
      user.id,
      id,
      user.id,
    ),
  ]);
  if (!result[1].meta.changes) throw new Problem(409, "Remove an old device before adding another");
  return { id };
}
export function notifyArrival(env: Bindings, box: string, id: string) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO push_jobs(event,device,mailbox_id,topic,due) SELECT m.id,d.id,m.mailbox_id,'mail',? FROM messages m LEFT JOIN thread_members t ON t.message_id=m.id AND t.mailbox_id=m.mailbox_id JOIN push_devices d ON d.new_mail=1 JOIN users u ON u.id=d.actor AND u.disabled_at IS NULL WHERE m.mailbox_id=? AND m.id=? AND m.folder='inbox' AND ${visibleInbox} AND NOT EXISTS(SELECT 1 FROM rule_runs r JOIN push_jobs j ON j.event=r.rule_id||':'||m.id AND j.device=d.id AND j.topic='rule' WHERE r.message_id=m.id AND r.mailbox_id=m.mailbox_id) AND (u.role IN ('admin','owner') OR EXISTS(SELECT 1 FROM mailbox_members g WHERE g.user_id=u.id AND g.mailbox_id=m.mailbox_id))`,
  ).bind(Date.now(), box, id);
}
type Job = { event: string; device: string; mailbox_id: string; topic: string; attempts: number };
async function deliver(env: Bindings, job: Job) {
  const query = job.topic === "egress" ? owning : "SELECT b.id " + mailboxAccess + " AND b.id=?";
  const d = await env.DB.prepare(
    "SELECT d.* FROM push_devices d WHERE d.id=? AND EXISTS(" +
      query.replace("u.id=?", "u.id=d.actor") +
      ") AND (? IN ('egress','approval','operations') OR d.new_mail=1) AND (?!='operations' OR EXISTS(SELECT 1 FROM users u JOIN ops_alerts a ON a.id=? AND a.resolved IS NULL WHERE u.id=d.actor AND u.role='owner' AND u.disabled_at IS NULL))",
  )
    .bind(job.device, job.mailbox_id, job.topic, job.topic, job.event)
    .first<Sealed & { site: string; actor: string }>();
  if (!d) return true;
  if (job.topic === "rule") {
    const [rule, id] = job.event.split(":");
    if (!(await activeNotification(env, job.mailbox_id, rule, id))) return true;
  }
  if (
    job.topic === "approval" &&
    !(await env.DB.prepare("SELECT 1 FROM agent_reviews WHERE id=? AND actor=? AND state='pending'")
      .bind(job.event, d.actor)
      .first())
  )
    return true;
  if (
    job.topic === "followup" &&
    !(await env.DB.prepare(
      "SELECT 1 FROM thread_state WHERE mailbox_id=? AND thread_id=? AND follow_ready=1 AND follow_up_at<=?",
    )
      .bind(job.mailbox_id, job.event, Date.now())
      .first())
  )
    return true;
  const sub: PushSubscription = JSON.parse(
    await unseal(env, "push/" + job.device + "/" + d.actor, d),
  );
  const keys = await vapid(env);
  const host = new URL(d.site).hostname;
  const message =
    job.topic === "operations"
      ? "A delivery alert needs your attention."
      : ["mail", "rule"].includes(job.topic)
        ? "A new message arrived."
        : job.topic === "approval"
          ? "A connected agent needs your approval."
          : job.topic === "followup"
            ? "A conversation is due for follow-up."
            : "A connected agent changed how mail leaves your mailbox.";
  const payload = await buildPushPayload(
    {
      data: JSON.stringify({ topic: job.topic, message, box: job.mailbox_id }),
      options: { ttl: 300 },
    },
    sub,
    { ...keys, subject: "mailto:postmaster@" + host },
  );
  const res = await fetch(endpoint(sub.endpoint), {
    ...payload,
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  await res.body?.cancel();
  if (res.status === 404 || res.status === 410) {
    await env.DB.prepare("DELETE FROM push_devices WHERE id=? AND actor=? AND ciphertext=?")
      .bind(job.device, d.actor, d.ciphertext)
      .run();
    return true;
  }
  return res.ok;
}
export async function flushPush(env: Bindings, event?: string) {
  const now = Date.now(),
    token = crypto.randomUUID();
  const jobs = await env.DB.prepare(
    "UPDATE push_jobs SET attempts=attempts+1,claim=?,due=? WHERE rowid IN (SELECT rowid FROM push_jobs WHERE due<=? AND (? IS NULL OR event=?) ORDER BY due LIMIT 8) RETURNING event,device,mailbox_id,topic,attempts",
  )
    .bind(token, now + 120000, now, event ?? null, event ?? null)
    .all<Job>();
  await Promise.all(
    jobs.results.map(async (job) => {
      const done = await deliver(env, job).catch(() => false);
      const args = [job.event, job.device, job.topic, token],
        match = " WHERE event=? AND device=? AND topic=? AND claim=?";
      if (done || job.attempts >= 6) {
        await env.DB.prepare("DELETE FROM push_jobs" + match)
          .bind(...args)
          .run();
        return;
      }
      await env.DB.prepare("UPDATE push_jobs SET due=?,claim=NULL" + match)
        .bind(Date.now() + 30000 * 2 ** job.attempts, ...args)
        .run();
    }),
  );
}

export function wakePush(env: Bindings, event: string) {
  return flushPush(env, event).catch(() => console.warn('{"event":"push_dispatch_deferred"}'));
}
