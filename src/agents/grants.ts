import { policySchema, storePolicy } from "./policies";
import { createHash, randomBytes } from "node:crypto";
import { ulid } from "ulid";
import * as z from "zod/mini";
import { Problem, type Bindings } from "../env";
import { mailboxAccess, type User } from "../ops/access";

const scopes = z
  .array(z.enum(["mail.read", "mail.write", "admin"]))
  .check(z.minLength(1), z.maxLength(3));
const selection = z.nullable(
  z
    .array(z.string().check(z.regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)))
    .check(z.minLength(1), z.maxLength(100)),
);
const input = z.object({
  name: z.string().check(z.minLength(1), z.maxLength(100)),
  scopes,
  policy: z.optional(policySchema),
  boxes: selection,
  days: z.number().check(z.int(), z.minimum(1), z.maximum(90)),
});
export type Scope = z.infer<typeof scopes>[number];
export const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export type Credential = {
  user: User;
  grant: string;
  scopes: Scope[];
  boxes: string[] | null;
  expires: number;
  depth: number;
  audience: string;
  tokenDigest?: string;
};
type Row = {
  id: string;
  actor: string;
  role: User["role"];
  parent: string | null;
  scopes: string;
  boxes: string | null;
  expires: number;
  revoked: number | null;
  audience: string;
};
export const chainSql = `WITH RECURSIVE ancestors AS (
 SELECT g.*,1 AS depth FROM agent_grants g WHERE g.id=?
 UNION ALL SELECT g.*,a.depth+1 FROM ancestors a JOIN agent_grants g ON g.id=a.parent WHERE a.depth<9
)`;
export function permits(allowed: Scope[], scope: Scope) {
  return (
    allowed.includes("admin") ||
    allowed.includes(scope) ||
    (scope === "mail.read" && allowed.includes("mail.write"))
  );
}
export async function resolveGrant(
  env: Bindings,
  id: string,
  audience: string,
): Promise<Credential> {
  const { results } = await env.DB.prepare(
    chainSql +
      ` SELECT a.*,u.role FROM ancestors a JOIN users u ON u.id=a.actor AND u.disabled_at IS NULL ORDER BY depth`,
  )
    .bind(id)
    .all<Row>();
  const leaf = results[0],
    last = results.at(-1),
    now = Date.now();
  if (
    !leaf ||
    last?.parent !== null ||
    results.length > 8 ||
    results.some(
      (g) =>
        g.revoked !== null || g.expires <= now || g.actor !== leaf.actor || g.audience !== audience,
    )
  )
    throw new Problem(401, "Grant expired or revoked");
  let allowed: Scope[] = ["mail.read", "mail.write", "admin"],
    boxes: string[] | null = null;
  for (const r of results) {
    const s = scopes.parse(JSON.parse(r.scopes));
    allowed = allowed.filter((k) => permits(s, k));
    const b = selection.parse(r.boxes === null ? null : JSON.parse(r.boxes));
    if (b) boxes = boxes === null ? b : boxes.filter((x) => b.includes(x));
  }
  return {
    user: { id: leaf.actor, kind: "user", role: leaf.role },
    grant: id,
    scopes: allowed,
    boxes,
    expires: Math.min(...results.map((r) => r.expires)),
    depth: results.length,
    audience,
  };
}
export async function authenticateAgent(env: Bindings, req: Request) {
  const match = /^Bearer ([^\s]{20,1024})$/i.exec(req.headers.get("authorization") || "");
  if (!match) throw new Problem(401, "Bearer token required");
  const key = digest(match[1]);
  const credential = await resolveToken(env, key, new URL(req.url).origin);
  await env.DB.prepare(
    "UPDATE agent_tokens SET last_used=? WHERE digest=? AND (last_used IS NULL OR last_used<?)",
  )
    .bind(Date.now(), key, Date.now() - 60000)
    .run();
  return credential;
}
async function resolveToken(env: Bindings, key: string, audience: string): Promise<Credential> {
  const token = await env.DB.prepare(
    `SELECT grant_id,expires,NULL AS scopes FROM agent_tokens WHERE digest=?1 AND expires>?2
    UNION ALL SELECT grant_id,expires,scopes FROM oauth_credentials WHERE digest=?1 AND expires>?2 AND kind='access' AND used=0`,
  )
    .bind(key, Date.now())
    .first<{ grant_id: string; expires: number; scopes: string | null }>();
  if (!token) throw new Problem(401, "Invalid or expired credential");
  const credential = await resolveGrant(env, token.grant_id, audience);
  if (token.scopes) {
    const effective = scopes.parse(JSON.parse(token.scopes));
    credential.scopes = credential.scopes.filter((k) => permits(effective, k));
  }
  return { ...credential, tokenDigest: key, expires: Math.min(credential.expires, token.expires) };
}
export function recheckCredential(env: Bindings, credential: Credential) {
  if (!credential.tokenDigest) throw new Problem(401, "Bearer token required");
  return resolveToken(env, credential.tokenDigest, credential.audience);
}
export async function prepareGrant(
  env: Bindings,
  user: User,
  origin: string,
  data: unknown,
  parent?: Credential,
) {
  const validated = input.safeParse(data);
  if (!validated.success)
    throw new Problem(400, "Choose scopes, mailboxes and a duration of 1 to 90 days");
  const v = validated.data;
  if (v.scopes.includes("admin") && user.role === "member")
    throw new Problem(403, "Administrator required");
  if (
    parent &&
    (parent.depth >= 8 ||
      !parent.scopes.includes("admin") ||
      v.scopes.some((s) => !permits(parent.scopes, s)) ||
      (parent.boxes !== null &&
        (v.boxes === null || v.boxes.some((b) => !parent.boxes?.includes(b)))))
  )
    throw new Problem(403, "Child credentials must narrow the parent grant");
  if (v.boxes) {
    const boxes = await env.DB.prepare(
      "SELECT b.id " + mailboxAccess + " AND b.id IN(SELECT value FROM json_each(?))",
    )
      .bind(user.id, JSON.stringify(v.boxes))
      .all();
    if (boxes.results.length !== new Set(v.boxes).size)
      throw new Problem(403, "Mailbox selection unavailable");
  }
  const id = ulid(),
    now = Date.now();
  const expires = Math.min(now + v.days * 86400000, parent?.expires ?? Infinity);
  const insert = env.DB.prepare(
    "INSERT INTO agent_grants(id,actor,parent,name,scopes,boxes,audience,expires,created) SELECT ?,id,?,?,?,?,?,?,? FROM users WHERE id=? AND disabled_at IS NULL",
  ).bind(
    id,
    parent?.grant || null,
    v.name,
    JSON.stringify(v.scopes),
    v.boxes ? JSON.stringify(v.boxes) : null,
    origin,
    expires,
    now,
    user.id,
  );
  return { id, expires, insert, policy: storePolicy(env, id, v.policy) };
}
export async function issueToken(
  env: Bindings,
  user: User,
  origin: string,
  data: unknown,
  parent?: Credential,
) {
  const { id, expires, insert, policy } = await prepareGrant(env, user, origin, data, parent);
  const token = "em_" + randomBytes(32).toString("base64url");
  await env.DB.batch([
    insert,
    ...policy,
    env.DB.prepare("INSERT INTO agent_tokens(digest,grant_id,expires) VALUES(?,?,?)").bind(
      digest(token),
      id,
      expires,
    ),
  ]);
  return { id, token, expires };
}
export async function myGrants(env: Bindings, user: User) {
  return (
    await env.DB.prepare(`SELECT g.id,g.name,g.scopes,g.boxes,g.expires,g.revoked,g.parent,p.send_mode,p.daily_cap,p.review_egress,max(t.last_used) AS last_used FROM agent_grants g LEFT JOIN agent_tokens t ON t.grant_id=g.id LEFT JOIN grant_policies p ON p.grant_id=g.id
 WHERE g.actor=? GROUP BY g.id ORDER BY g.created DESC LIMIT 200`)
      .bind(user.id)
      .all()
  ).results;
}
export async function revokeGrant(env: Bindings, user: User, id: string) {
  const r = await env.DB.prepare(
    "UPDATE agent_grants SET revoked=coalesce(revoked,?) WHERE id=? AND actor=?",
  )
    .bind(Date.now(), id, user.id)
    .run();
  if (!r.meta.changes) throw new Problem(404, "Grant unavailable");
  return { revoked: true };
}
