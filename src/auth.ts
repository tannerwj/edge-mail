import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { Problem, type Bindings } from "./env";
import { address } from "./address";

// Only the local development command defines this compile-time flag.
declare const LOCAL_IDENTITY_ENABLED: boolean;
let remote: { issuer: string; keys: ReturnType<typeof createRemoteJWKSet> } | undefined;
export async function identity(request: Request, env: Bindings) {
  if (LOCAL_IDENTITY_ENABLED && new URL(request.url).hostname === "127.0.0.1" && env.DEV_IDENTITY)
    return { email: address(env.DEV_IDENTITY).canonical, expires: Date.now() + 3600000 };
  return humanIdentity(await accessClaims(request, env));
}
export function humanIdentity(payload: Awaited<ReturnType<typeof accessClaims>>) {
  if (typeof payload.sub !== "string" || !payload.sub || typeof payload.email !== "string")
    throw new Problem(401, "Invalid Access assertion");
  try {
    return { email: address(payload.email).canonical, expires: Number(payload.exp) * 1000 };
  } catch {
    throw new Problem(401, "Invalid Access assertion");
  }
}
export async function accessClaims(request: Request, env: Bindings) {
  if (
    !env.ACCESS_AUD ||
    !env.ACCESS_TEAM_DOMAIN ||
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN)
  )
    throw new Problem(503, "Access not configured");
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion) throw new Problem(401, "Sign in through Cloudflare Access");
  const issuer = "https://" + env.ACCESS_TEAM_DOMAIN;
  if (remote?.issuer !== issuer)
    remote = { issuer, keys: createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer)) };
  try {
    const { payload } = await jwtVerify(assertion, remote.keys, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "type"],
    });
    if (payload.type !== "app") throw new Problem(401, "Invalid identity");
    return payload;
  } catch (error) {
    if (
      error instanceof errors.JWKSTimeout ||
      error instanceof TypeError ||
      (error instanceof errors.JOSEError && error.code === "ERR_JOSE_GENERIC")
    )
      throw new Problem(503, "Access keys unavailable");
    throw new Problem(401, "Invalid Access assertion");
  }
}
