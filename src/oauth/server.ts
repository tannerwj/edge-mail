import { OAuthError, OAuthAuthorizationServer } from "@cloudflare/workers-oauth-provider";
import { resolveGrant } from "../agents/grants";
import type { Bindings } from "../env";
export const scopeNames = ["mail.read", "mail.write", "admin"];
export function authorizationServer(env: Bindings, origin: string) {
  return new OAuthAuthorizationServer<Bindings>({
    issuer: origin,
    authorizeEndpoint: "/oauth/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    resources: [origin + "/mcp"],
    defaultResource: origin + "/mcp",
    scopesSupported: scopeNames,
    accessTokenTTL: 900,
    refreshTokenTTL: 90 * 86400,
    clientRegistrationTTL: 30 * 86400,
    clientIdMetadataDocumentEnabled: true,
    tokenExchangeCallback: async (options) => {
      const grant = options.props?.grant;
      if (typeof grant !== "string")
        throw new OAuthError("invalid_grant", { description: "Unknown authorization" });
      try {
        const c = await resolveGrant(env, grant, origin);
        if (c.user.id !== options.userId) throw Error();
        return { accessTokenTTL: Math.min(900, Math.floor((c.expires - Date.now()) / 1000)) };
      } catch {
        throw new OAuthError("invalid_grant", { description: "Authorization expired or revoked" });
      }
    },
  });
}
