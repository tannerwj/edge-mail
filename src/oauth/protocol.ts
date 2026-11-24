import { boundedText } from "../request-json";
import * as z from "zod/mini";
import { type Bindings } from "../env";
import { digest, resolveGrant } from "../agents/grants";
import { authorizationServer } from "./server";
const tokenPair = z.object({
  access_token: z.string(),
  refresh_token: z.optional(z.string()),
  expires_in: z.number(),
  scope: z.optional(z.string()),
});
type Row = { grant_id: string; client: string; kind: string; used: number; expires: number };
const error = (message: string, status = 400) =>
  Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
async function reserveRegistration(env: Bindings) {
  const id = crypto.randomUUID(),
    now = Date.now();
  await env.DB.prepare("DELETE FROM oauth_registrations WHERE expires<=?").bind(now).run();
  const result = await env.DB.prepare(
    "INSERT INTO oauth_registrations SELECT ?,? WHERE (SELECT count(*) FROM oauth_registrations)<256",
  )
    .bind(id, now + 30 * 86400000)
    .run();
  return result.meta.changes ? id : null;
}
async function tokenContext(req: Request, env: Bindings, body: string) {
  const q = new URLSearchParams(body),
    raw = q.get("refresh_token") || q.get("token"),
    key = raw ? digest(raw) : "";
  const previous = key
    ? await env.DB.prepare(
        "SELECT grant_id,kind,client,used,expires FROM oauth_credentials WHERE digest=?",
      )
        .bind(key)
        .first<Row>()
    : null;
  const refreshing = q.get("grant_type") === "refresh_token";
  let client = q.get("client_id") || "";
  const basic = req.headers.get("authorization");
  if (basic?.startsWith("Basic ")) {
    try {
      client = decodeURIComponent(atob(basic.slice(6)).split(":")[0]);
    } catch {
      return { failure: error("invalid_client", 401) };
    }
  }
  if (!refreshing)
    return { previous: previous?.client === client ? previous : null, key, refreshing };
  if (
    !previous ||
    previous.kind !== "refresh" ||
    previous.client !== client ||
    previous.expires <= Date.now()
  )
    return { failure: error("invalid_grant") };
  if (previous.used === 1) {
    await env.DB.prepare("UPDATE agent_grants SET revoked=coalesce(revoked,?) WHERE id=?")
      .bind(Date.now(), previous.grant_id)
      .run();
    return { failure: error("invalid_grant") };
  }
  const lock = await env.DB.prepare("UPDATE oauth_credentials SET used=2 WHERE digest=? AND used=0")
    .bind(key)
    .run();
  if (!lock.meta.changes) return { failure: error("invalid_grant") };
  return { previous, key, refreshing };
}
async function recordTokens(env: Bindings, origin: string, data: unknown) {
  const pair = tokenPair.parse(data);
  const verified = await authorizationServer(env, origin).validateToken<{ grant: string }>(
    origin + "/mcp",
    pair.access_token,
    env,
  );
  if (!verified) throw Error("Invalid issued access token");
  const c = await resolveGrant(env, verified.props.grant, origin);
  const save = (token: string, kind: string, expires: number) =>
    env.DB.prepare(
      "INSERT INTO oauth_credentials(digest,grant_id,client,scopes,kind,expires) VALUES(?,?,?,?,?,?)",
    ).bind(
      digest(token),
      c.grant,
      verified.clientId,
      JSON.stringify(verified.scope),
      kind,
      expires,
    );
  const writes = [
    save(pair.access_token, "access", Math.min(c.expires, verified.expiresAt * 1000)),
  ];
  if (pair.refresh_token) writes.push(save(pair.refresh_token, "refresh", c.expires));
  return writes;
}
async function tokens(req: Request, env: Bindings, ctx: ExecutionContext, origin: string) {
  if (
    req.method !== "POST" ||
    !req.headers.get("content-type")?.includes("application/x-www-form-urlencoded")
  )
    return error("invalid_request");
  const body = await boundedText(req, 16384);
  const current = await tokenContext(req, env, body);
  if (current.failure) return current.failure;
  const { previous, key, refreshing } = current;
  const result = await authorizationServer(env, origin).fetch(
    new Request(req.url, { method: "POST", headers: req.headers, body }),
    env,
    ctx,
  );
  if (!result.ok) {
    if (refreshing)
      await env.DB.prepare("UPDATE oauth_credentials SET used=0 WHERE digest=? AND used=2")
        .bind(key)
        .run();
    return result;
  }
  if (result.headers.get("content-type")?.includes("application/json")) {
    const writes = await recordTokens(env, origin, await result.clone().json());
    if (refreshing)
      writes.push(
        env.DB.prepare("UPDATE oauth_credentials SET used=1 WHERE digest=? AND used=2").bind(key),
      );
    await env.DB.batch(writes);
  } else if (previous) {
    if (previous.kind === "refresh")
      await env.DB.prepare("UPDATE agent_grants SET revoked=coalesce(revoked,?) WHERE id=?")
        .bind(Date.now(), previous.grant_id)
        .run();
    else await env.DB.prepare("UPDATE oauth_credentials SET used=1 WHERE digest=?").bind(key).run();
  }
  return result;
}
export async function oauthProtocol(req: Request, env: Bindings, ctx: ExecutionContext) {
  const url = new URL(req.url),
    server = authorizationServer(env, url.origin);
  if (url.pathname === "/oauth/token") return tokens(req, env, ctx, url.origin);
  if (url.pathname !== "/oauth/register" || req.method !== "POST")
    return server.fetch(req, env, ctx);
  if (
    !(
      await env.SETUP_LIMIT.limit({
        key: "oauth-register:" + (req.headers.get("cf-connecting-ip") || "local"),
      })
    ).success
  )
    return error("temporarily_unavailable", 429);
  const id = await reserveRegistration(env);
  if (!id) return error("temporarily_unavailable", 429);
  const r = await server.fetch(req, env, ctx);
  if (!r.ok) await env.DB.prepare("DELETE FROM oauth_registrations WHERE id=?").bind(id).run();
  return r;
}

export async function sweepOAuth(env: Bindings) {
  const now = Date.now();
  await env.DB.batch(
    ["oauth_credentials", "oauth_pending", "oauth_registrations"].map((table) =>
      env.DB.prepare(
        "DELETE FROM " +
          table +
          " WHERE rowid IN (SELECT rowid FROM " +
          table +
          " WHERE expires<=? ORDER BY expires LIMIT 200)",
      ).bind(now),
    ),
  );
}
