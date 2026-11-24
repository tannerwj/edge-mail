export { MailboxLive } from "../src/live";
export { OutboxClock } from "../src/outbox-clock";
import { createHash } from "node:crypto";
import worker from "../src/worker";
import { accessClaims, humanIdentity } from "../src/auth";
import { http } from "../src/http";
import { readJson } from "../src/request-json";
import { Problem, type Bindings } from "../src/env";

interface Staging extends Bindings {
  VERIFICATION_CLIENT_DIGEST?: string;
}
async function readerConsent(req: Request) {
  if (req.method !== "POST" || new URL(req.url).pathname !== "/api/oauth/consent") return false;
  const d = await readJson(req.clone(), 16384);
  if (d.action === "begin")
    return typeof d.query === "string" && new URLSearchParams(d.query).get("scope") === "mail.read";
  if (d.action === "deny") return true;
  return (
    d.action === "approve" &&
    Array.isArray(d.scopes) &&
    d.scopes.length === 1 &&
    d.scopes[0] === "mail.read" &&
    d.days === 1 &&
    Array.isArray(d.boxes) &&
    d.boxes.length === 1
  );
}
async function syntheticSearch(req: Request) {
  if (
    req.method !== "POST" ||
    !/^\/api\/mailboxes\/[0-9A-HJKMNP-TV-Z]{26}\/assistant$/.test(new URL(req.url).pathname)
  )
    return false;
  const data = await readJson(req.clone(), 512);
  return (
    Object.keys(data).length === 2 &&
    data.action === "search" &&
    data.prompt ===
      "Find messages whose subject contains the word fieldbook. Return subject:fieldbook."
  );
}
async function identity(request: Request, env: Staging) {
  const claims = await accessClaims(request, env);
  if (typeof claims.common_name !== "string" || claims.email) return humanIdentity(claims);
  const digest = createHash("sha256").update(claims.common_name).digest("hex");
  if (claims.sub || digest !== env.VERIFICATION_CLIENT_DIGEST)
    throw new Problem(401, "Unknown verification client");
  if (
    !["GET", "HEAD"].includes(request.method) &&
    !(await readerConsent(request)) &&
    !(await syntheticSearch(request))
  )
    throw new Problem(403, "Verification is read-only");
  return { email: "release-reader@verification.invalid", expires: Number(claims.exp) * 1000 };
}
export default {
  ...worker,
  fetch(request: Request, env: Staging, ctx: ExecutionContext) {
    return http(request, env, identity, ctx);
  },
};
