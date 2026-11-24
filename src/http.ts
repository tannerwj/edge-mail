import { projectFeedback } from "./project-feedback";
import { discardAction, undoSubmission } from "./ops/compose-undo";
import { transportPolicy } from "./transport-policy";
import { standardMailboxes } from "./ops/standard-mailboxes";
import { notificationTargets } from "./ops/rule-notifications";
import { explain } from "./ops/message-explain";
import { mailboxQuota } from "./ops/mailbox-quota";
import { readSettings } from "./http-settings";
import { searchBookmarks } from "./ops/search-bookmarks";
import { leaveList } from "./ops/list-unsubscribe";
import { personErasure } from "./person-erasure";
import { aiSettings, mailboxAssistant } from "./ops/mailbox-ai";

import { reportDashboard } from "./ops/reports";
import { changeLimits } from "./ops/budgets";
import { removeSuppression } from "./ops/suppressions";
import { addressSettings, disposable, plusPreference, unknownRecipients } from "./ops/disposable";
import { library, saveLibrary } from "./ops/composer-library";
import { decide } from "./ops/approvals";
import { setThreadState } from "./ops/thread-state";
import { invite, addLogin } from "./ops/people";
import { listHooks, changeHook } from "./ops/webhooks";
import { eraseMessage, erasureReceipts } from "./ops/erasure";
import { mailboxIdentities, saveSignature } from "./ops/identities";
import { changePush } from "./ops/push";
import { acknowledge } from "./ops/notices";
import { archiveTransfer } from "./ops/portability";
import { activity, undoAction } from "./agents/activity";
import { consent } from "./oauth/consent";
import { oauthProtocol } from "./oauth/protocol";
import { screenSettings, changeScreen, trainMessage } from "./ops/screen-settings";
import { destinations, destinationChange } from "./ops/destinations";
import { ruleChange, ruleDetail } from "./ops/rules";
import { listRules } from "./ops/rule-definitions";
import { offboard } from "./ops/offboard";
import { uploadFile } from "./ops/compose-files";
import { importDomains } from "./ops/domain-import";

import { formatted } from "./ops/formatted";
import { attachments, contentResponse, calendarPreview } from "./ops/attachments";
import { connectLive } from "./live";
import assets from "./install-assets.json";
import { readJson } from "./request-json";
import { agentHttp } from "./agents/http";
import { issueToken, revokeGrant } from "./agents/grants";
import { offline } from "./ops/offline";
import { readiness } from "./ops/operations";
import { providerProbe } from "./ops/provider-probe";
import { identity } from "./auth";
import { type Bindings, Problem } from "./env";
import { bootstrap, lookup, setupOpen, type User } from "./ops/access";
import { addDomain, addMailbox, addAlias, addUser, grant, grantDomain } from "./ops/mailboxes";
import { outbox, submitDraft, cancelSend } from "./ops/outbox";
import { drafts, saveDraft } from "./ops/drafts";
import { triage } from "./ops/triage";
import { inbox, readMessage } from "./ops/inbox";

const headers = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "private, no-store",
};
function sameOrigin(req: Request) {
  if (
    req.headers.get("Sec-Fetch-Site") !== "same-origin" &&
    (req.headers.has("Sec-Fetch-Site") || req.headers.get("Origin") !== new URL(req.url).origin)
  )
    throw new Problem(403, "Same-origin request required");
}
function input(req: Request, limit = 8192) {
  sameOrigin(req);
  return readJson(req, limit);
}
function mailboxContent(
  env: Bindings,
  user: User,
  box: string,
  action: string,
  id: string,
  url: URL,
) {
  if (action === "explain") return explain(env, user, box, id);
  if (action === "calendar")
    return calendarPreview(env, user.id, box, id, url.searchParams.get("part"));
  if (action === "attachments" || action === "preview")
    return attachments(
      env,
      user.id,
      box,
      id,
      url.searchParams.get("part"),
      action === "preview" ? "preview" : undefined,
    );
  return formatted(env, user.id, box, id, url.origin, action === "images" ? "once" : undefined);
}
function mailboxRead(
  env: Bindings,
  user: User,
  box: string,
  action: string,
  id: string | undefined,
  url: URL,
) {
  if (action === "webhooks") return listHooks(env, user, box);
  if (action === "erasures") return erasureReceipts(env, user, box, id);
  if (action === "identities" && !id) return mailboxIdentities(env, user, box);
  if (action === "activity" && !id) return activity(env, user, box);
  if (action === "screening" && !id) return screenSettings(env, user, box);
  if (
    ["formatted", "images", "attachments", "calendar", "explain", "preview"].includes(action) &&
    id
  )
    return mailboxContent(env, user, box, action, id, url);
  if (action === "destinations" && !id) return destinations(env, user, box);
  if (action === "rules") return id ? ruleDetail(env, user, box, id) : listRules(env, user, box);
  if (action === "outbox") return outbox(env, user, box, id);
  if (action === "drafts") return drafts(env, user, box, id);
  if (action === "messages")
    return id ? readMessage(env, user, box, id) : inbox(env, user, box, url.searchParams);
  throw new Problem(404, "Unknown mailbox operation");
}
function readApi(env: Bindings, user: User, url: URL) {
  const [, , area, box, action, id] = url.pathname.split("/");
  if (area !== "mailboxes" || !box) return readSettings(env, user, url);
  if (!id && ["reports", "assistant"].includes(action))
    return action === "reports" ? reportDashboard(env, user, box) : aiSettings(env, user, box);
  if (action === "disposable") return addressSettings(env, user, box);
  if (["library", "contacts"].includes(action))
    return library(
      env,
      user,
      box,
      url.searchParams.get("q") || "",
      action === "contacts" ? "contacts" : undefined,
    );
  if (action === "rule-targets") return notificationTargets(env, user, box);
  if (action === "quota") return mailboxQuota(env, user, box);
  return mailboxRead(env, user, box, action, id, url);
}
async function api(req: Request, env: Bindings, user: User, url: URL) {
  const [, , area, box, action, id, extra] = url.pathname.split("/");
  if (extra) throw new Problem(404, "Unknown operation");
  if (req.method === "GET") return readApi(env, user, url);
  if (req.method === "POST") {
    if (area === "mailboxes" && box && action === "drafts") {
      const data = await input(req, 600000);
      if (id && (data.action === "discard" || data.action === "restore"))
        return discardAction(env, user, box, id, data);
      return saveDraft(env, user, box, id, data);
    }
    const data = await input(req, area === "mailboxes" && action === "library" ? 48000 : 8192);
    if (area === "mailboxes" && box && id && action === "formatted")
      return formatted(env, user.id, box, id, url.origin, data.images);
    if (area === "mailboxes" && box && id && action === "outbox")
      return outboxAction(env, user, box, id, data);
    return mutate(env, user, url, data);
  }
  throw new Problem(404, "Unknown operation");
}
function outboxAction(
  env: Bindings,
  user: User,
  box: string,
  id: string,
  data: Record<string, unknown>,
) {
  if (data.action === "undo") return undoSubmission(env, user, box, id);
  if (data.action === "cancel") return cancelSend(env, user, box, id);
  if (data.action === "send") return submitDraft(env, user, box, id, data);
  throw new Problem(400, "Invalid outbox action");
}
function mailboxWrite(
  env: Bindings,
  user: User,
  box: string,
  action: string,
  id: string | undefined,
  data: Record<string, unknown>,
) {
  if (action === "reminders" && !id)
    return setThreadState(env, { user }, box, String(data.action), data);
  if (action === "quota") return mailboxQuota(env, user, box, data);
  if (action === "webhooks") return changeHook(env, { user }, box, String(data.action), data);
  if (id && ["erase", "unsubscribe"].includes(action))
    return action === "erase"
      ? eraseMessage(env, user, box, id, data.confirm)
      : leaveList(env, user.id, box, id, data.confirm);
  if (action === "signatures" && !id) return saveSignature(env, user, box, data);
  if (action === "activity" && id) return undoAction(env, { user }, box, id, data.dry_run === true);
  if (action === "screening")
    return id ? trainMessage(env, user, box, id, data.spam) : changeScreen(env, user, box, data);
  if (action === "destinations" && !id) return destinationChange(env, user, box, data);
  if (action === "rules") return ruleChange(env, user, box, id, data);
  if (action === "messages" && id) return triage(env, user, box, [id], data);
  if (!id) return mailboxCollection(env, user, box, action, data);
  throw new Problem(404, "Unknown mailbox operation");
}
function mailboxCollection(
  env: Bindings,
  user: User,
  box: string,
  action: string,
  data: Record<string, unknown>,
) {
  if (action === "assistant") return mailboxAssistant(env, user, box, data);
  if (action === "triage") return triage(env, user, box, data.ids, data);
  if (action === "disposable")
    return data.action === "plus"
      ? plusPreference(env, user, box, data.on)
      : disposable(env, user, box, data);
  if (action === "library") return saveLibrary(env, user, box, data);
  if (action === "aliases") return addAlias(env, user, box, data.address);
  if (action === "members") return grant(env, user, box, data);
  throw new Problem(404, "Unknown mailbox operation");
}
function noticeAction(env: Bindings, user: User, path: string) {
  const match = /^\/api\/notices\/([0-9A-HJKMNP-TV-Z]{26})\/ack$/.exec(path);
  if (!match) throw new Problem(404, "Unknown notice operation");
  return acknowledge(env, user, match[1]);
}
function peopleAction(env: Bindings, user: User, url: URL, data: Record<string, unknown>) {
  switch (url.pathname) {
    case "/api/users":
      return addUser(env, user, data);
    case "/api/users/erasure":
      return personErasure(env, user, data);
    case "/api/users/offboard":
      return offboard(env, user, data);
    case "/api/users/invitations":
      return invite(env, user, data, url.origin);
    case "/api/users/logins":
      return addLogin(env, user, data);
    default:
      throw new Problem(404, "Unknown user operation");
  }
}
function accountWrite(env: Bindings, user: User, url: URL, data: Record<string, unknown>) {
  const [, , area, box, action, id] = url.pathname.split("/");
  if (url.pathname === "/api/searches") return searchBookmarks(env, user, data.box, data);
  if (url.pathname === "/api/limits") return changeLimits(env, user, data);
  if (url.pathname === "/api/suppressions") return removeSuppression(env, user, data);
  if (area === "approvals" && box && !action) return decide(env, user, box, data.approve);
  if (url.pathname === "/api/grants") return issueToken(env, user, url.origin, data);
  if (area === "grants" && box && action === "revoke" && !id) return revokeGrant(env, user, box);
  if (url.pathname === "/api/notifications") return changePush(env, user, data, url.origin);
  throw new Problem(404, "Unknown account operation");
}
async function mutate(env: Bindings, user: User, url: URL, data: Record<string, unknown>) {
  const [, , area, box, action, id] = url.pathname.split("/");
  if (area === "mailboxes" && box && action === "reports" && !id)
    return reportDashboard(env, user, box, data.enabled);
  if (area === "mailboxes" && box) return mailboxWrite(env, user, box, action, id, data);
  if (["approvals", "grants", "notifications", "limits", "suppressions", "searches"].includes(area))
    return accountWrite(env, user, url, data);
  if (url.pathname === "/api/project-feedback") return projectFeedback(env, user.id, data);
  if (area === "notices") return noticeAction(env, user, url.pathname);
  if (url.pathname === "/api/provider-probe") return providerProbe(env, user, data.path);
  if (area === "domains") return mutateDomain(env, user, url, data);
  if (url.pathname === "/api/mailboxes") return addMailbox(env, user, data);
  if (area === "users") return peopleAction(env, user, url, data);
  throw new Problem(404, "Unknown operation");
}
function mutateDomain(env: Bindings, user: User, url: URL, data: Record<string, unknown>) {
  const [, , , box, action] = url.pathname.split("/");
  if (box && action === "standard-mailboxes") return standardMailboxes(env, user, box);
  if (box && action === "unknown-recipients") return unknownRecipients(env, user, box, data);
  if (url.pathname === "/api/domains/import") return importDomains(env, user, data);
  if (url.pathname === "/api/domains") return addDomain(env, user, data.name);
  if (box && action === "admins") return grantDomain(env, user, box, data.email);
  throw new Problem(404, "Unknown domain operation");
}
async function health(env: Bindings) {
  const { schemaReady, missing } = await readiness(env);
  const ready = schemaReady && missing.length === 0;
  return Response.json({ ready }, { status: ready ? 200 : 503 });
}
async function userRequest(req: Request, env: Bindings, user: User, url: URL, expires: number) {
  const archive =
    /^\/api\/mailboxes\/([0-9A-HJKMNP-TV-Z]{26})\/archive(?:\/([0-9A-HJKMNP-TV-Z]{26}))?$/.exec(
      url.pathname,
    );
  if (archive) {
    if (req.method !== "GET") sameOrigin(req);
    return archiveTransfer(req, env, user, archive[1], archive[2], url);
  }
  if (url.pathname === "/api/oauth/consent" && req.method === "POST")
    return consent(req, env, user, await input(req, 16384));
  if (req.method === "PUT") {
    const upload =
      /^\/api\/mailboxes\/([0-9A-HJKMNP-TV-Z]{26})\/drafts\/([0-9A-HJKMNP-TV-Z]{26})\/([a-f0-9]{64})$/.exec(
        url.pathname,
      );
    if (!upload) throw new Problem(404, "Unknown upload route");
    sameOrigin(req);
    return Response.json(await uploadFile(env, user, upload[1], upload[2], upload[3], req));
  }
  const live = /^\/api\/live\/([0-9A-HJKMNP-TV-Z]{26})$/.exec(url.pathname);
  if (req.method === "GET" && live) return connectLive(req, env, user, live[1], expires);
  if (
    req.method === "GET" &&
    ["/api/offline/session", "/api/offline/threads"].includes(url.pathname)
  )
    return Response.json(await offline(env, user, expires, url));
  return Response.json(await api(req, env, user, url));
}
const installAssets = new Set([assets.manifest, ...assets.icons, ...Object.keys(assets.reader)]);
function agentRoute(path: string) {
  return (
    path === "/mcp" ||
    path.startsWith("/v1/") ||
    path === "/.well-known/oauth-protected-resource/mcp"
  );
}
async function route(req: Request, env: Bindings, authenticate: typeof identity) {
  const url = new URL(req.url);
  if (installAssets.has(url.pathname) && ["GET", "HEAD"].includes(req.method))
    return env.ASSETS.fetch(req);
  if (url.pathname === "/healthz") return health(env);
  if (agentRoute(url.pathname)) return agentHttp(req, env, url);
  const who = await authenticate(req, env);
  if (url.pathname === "/api/setup" && req.method === "POST") {
    if (
      !(await env.SETUP_LIMIT.limit({ key: req.headers.get("CF-Connecting-IP") || "local" }))
        .success
    )
      throw new Problem(429, "Try again later");
    await bootstrap(env, who, (await input(req)).token);
    return Response.json({ ok: true }, { status: 201 });
  }
  const user = await lookup(env, who);
  if (url.pathname === "/api/session" && req.method === "GET")
    return Response.json({
      email: who.email,
      role: user?.role || null,
      setup: !user && (await setupOpen(env)),
    });
  if (url.pathname === "/setup" && !(await setupOpen(env)))
    throw new Problem(410, "Setup is closed");
  if (url.pathname.startsWith("/api/")) {
    if (!user) throw new Problem(403, "No access");
    return userRequest(req, env, user, url, who.expires);
  }
  if (!["GET", "HEAD"].includes(req.method)) throw new Problem(405, "Method unavailable");
  return env.ASSETS.fetch(req);
}
const protocolPaths = new Set([
  "/.well-known/oauth-authorization-server",
  "/oauth/register",
  "/oauth/token",
]);
function problemResponse(req: Request, env: Bindings, message: string, status: number) {
  const setupHelp =
    message === "Access not configured" &&
    req.method === "GET" &&
    ["/", "/app", "/setup"].includes(new URL(req.url).pathname) &&
    req.headers.get("Accept")?.includes("text/html");
  return setupHelp
    ? env.ASSETS.fetch(new URL("/install/connect.html", req.url))
    : Response.json({ error: message }, { status });
}
export async function http(
  req: Request,
  env: Bindings,
  authenticate = identity,
  ctx?: ExecutionContext,
) {
  const url = new URL(req.url);
  if (url.hostname.startsWith("mta-sts.")) return transportPolicy(req, env, url);
  if (env.CONTENT_ORIGIN && url.origin === env.CONTENT_ORIGIN) return contentResponse(req, env);
  let res: Response;
  try {
    if (protocolPaths.has(new URL(req.url).pathname) && ctx)
      res = await oauthProtocol(req, env, ctx);
    else res = await route(req, env, authenticate);
  } catch (error) {
    const conflict = error instanceof Error && /UNIQUE constraint failed/.test(error.message);
    const status = error instanceof Problem ? error.status : conflict ? 409 : 500;
    const message =
      error instanceof Problem ? error.message : conflict ? "Already exists" : "Request failed";
    if (status === 500) console.error(JSON.stringify({ event: "request_failed" }));
    res = await problemResponse(req, env, message, status);
  }
  if (res.webSocket) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  if (env.CONTENT_ORIGIN)
    out.headers.set(
      "Content-Security-Policy",
      headers["Content-Security-Policy"] + "; frame-src " + new URL(env.CONTENT_ORIGIN).origin,
    );
  return out;
}
