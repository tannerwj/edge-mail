import { resolveGrant, permits } from "./agents/grants";
import { SignJWT, jwtVerify } from "jose";
import { type Bindings, Problem } from "./env";
import { contentKey } from "./instance-key";
import { mailboxAccess } from "./ops/access";

const id = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const permitted = (env: Bindings, user: string, box: string, message: string) =>
  env.DB.prepare(
    "SELECT m.attachment_count,COALESCE((SELECT d.raw_key FROM deliveries d WHERE d.mailbox_id=m.mailbox_id AND d.message_id=m.id LIMIT 1),CASE WHEN m.content_hash='sent-'||m.id THEN 'sent/'||m.mailbox_id||'/'||m.id||'.eml' END) AS raw_key FROM messages m WHERE m.id=? AND m.mailbox_id IN (SELECT b.id " +
      mailboxAccess +
      " AND b.id=?)",
  )
    .bind(message, user, box)
    .first<{ attachment_count: number; raw_key: string | null }>();

type Use = "file" | "html" | "img" | "preview";
export async function issueTicket(
  env: Bindings,
  use: Use,
  user: string,
  box: string,
  message: string,
  scope: Record<string, string | number>,
) {
  return signTicket(env, use, { user, box, message }, scope, await contentKey(env, true));
}
export async function signTicket(
  env: Bindings,
  use: Use,
  target: { user: string; box: string; message: string },
  scope: Record<string, string | number>,
  key: CryptoKey,
) {
  const { box, user, message } = target;
  const aud = env.CONTENT_ORIGIN;
  if (!aud) throw new Problem(503, "Content host unavailable");
  const token = await new SignJWT({ box, message, ...scope })
    .setProtectedHeader({ alg: "HS256", typ: "edge-mail-" + use })
    .setSubject(user)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(Math.min(Math.floor(Date.now() / 1000) + 300, Number(scope.exp ?? Infinity)))
    .sign(key);
  return { href: aud + "/" + use + "/" + token };
}
export async function readTicket(env: Bindings, use: Use, token: string) {
  if (token.length > 2048 || token.split(".").length !== 3) throw Error("Invalid ticket");
  const { payload, protectedHeader } = await jwtVerify(token, await contentKey(env, false), {
    audience: env.CONTENT_ORIGIN,
    algorithms: ["HS256"],
    requiredClaims: ["exp", "iat", "sub"],
    maxTokenAge: "5m",
  });
  const { sub, box, message } = payload;
  if (
    protectedHeader.typ !== "edge-mail-" + use ||
    typeof sub !== "string" ||
    typeof payload.exp !== "number" ||
    typeof box !== "string" ||
    typeof message !== "string" ||
    !id.test(box) ||
    !id.test(message)
  )
    throw Error("Invalid ticket");
  if (payload.grant !== undefined) {
    if (typeof payload.grant !== "string" || typeof payload.app !== "string")
      throw Error("Invalid grant ticket");
    const c = await resolveGrant(env, payload.grant, payload.app);
    if (c.user.id !== sub || !permits(c.scopes, "mail.read") || (c.boxes && !c.boxes.includes(box)))
      throw Error("Access changed");
  }
  if (!(await permitted(env, sub, box, message))) throw Error("Access changed");
  return { box, message, user: sub, expires: payload.exp, payload };
}
