import { AuthorizationError } from "@cloudflare/workers-oauth-provider";
import { digest, prepareGrant } from "../agents/grants";
import { type Bindings, Problem } from "../env";
import type { User } from "../ops/access";
import { authorizationServer } from "./server";
async function beginConsent(env: Bindings, user: User, origin: string, query: unknown) {
  const oauth = authorizationServer(env, origin).getOAuthApi(env);
  if (typeof query !== "string" || query.length > 8192)
    throw new Problem(400, "Invalid authorization request");
  const auth = await oauth.parseAuthRequest(new Request(origin + "/oauth/authorize?" + query));
  if (
    !auth.codeChallenge ||
    auth.codeChallengeMethod !== "S256" ||
    auth.resource !== origin + "/mcp"
  )
    throw new Problem(400, "This client must request this mailbox service using PKCE S256");
  const details = await oauth.describeConsent(auth),
    pending = await oauth.beginConsent(auth);
  await env.DB.prepare("INSERT INTO oauth_pending VALUES(?,?,?)")
    .bind(digest(pending.handle), user.id, Date.now() + 600000)
    .run();
  return Response.json({ details, handle: pending.handle }, { headers: pending.headers });
}
export async function consent(
  req: Request,
  env: Bindings,
  user: User,
  data: Record<string, unknown>,
) {
  const origin = new URL(req.url).origin,
    oauth = authorizationServer(env, origin).getOAuthApi(env);
  try {
    if (data.action === "begin") return await beginConsent(env, user, origin, data.query);
    if (typeof data.handle !== "string" || data.handle.length > 1024)
      throw new Problem(400, "Authorization expired");
    const reserved = await env.DB.prepare(
      "DELETE FROM oauth_pending WHERE digest=? AND actor=? AND expires>? RETURNING actor",
    )
      .bind(digest(data.handle), user.id, Date.now())
      .first();
    if (!reserved) throw new Problem(400, "Authorization expired. Reconnect from the client.");
    if (data.action === "deny") {
      const denied = await oauth.denyConsent(req, data.handle);
      return Response.json(
        { redirect: denied.headers.get("Location") },
        { headers: denied.headers },
      );
    }
    if (
      data.action !== "approve" ||
      !Array.isArray(data.scopes) ||
      !data.scopes.every((s) => typeof s === "string")
    )
      throw new Problem(400, "Choose permissions");
    const approved = await oauth.approveConsent(req, data.handle, { scope: data.scopes });
    const details = await oauth.describeConsent(approved.request);
    const grant = await prepareGrant(env, user, origin, {
      name: details.clientName.slice(0, 100),
      scopes: approved.request.scope,
      boxes: data.boxes,
      policy: data.policy,
      days: data.days,
    });
    await env.DB.batch([grant.insert, ...grant.policy]);
    try {
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: user.id,
        scope: approved.request.scope,
        props: { grant: grant.id },
        metadata: {},
        revokeExistingGrants: false,
      });
      return Response.json({ redirect: redirectTo }, { headers: approved.headers });
    } catch (e) {
      await env.DB.prepare("UPDATE agent_grants SET revoked=? WHERE id=?")
        .bind(Date.now(), grant.id)
        .run();
      throw e;
    }
  } catch (e) {
    if (e instanceof AuthorizationError) throw new Problem(400, e.message);
    throw e;
  }
}
