import { receiveUpload } from "./uploads";
import { mcp } from "./mcp";
import { Problem, type Bindings } from "../env";
import { readJson } from "../request-json";
import { authenticateAgent, permits } from "./grants";
import { catalog } from "./catalog";
import { executeOperation } from "./operations";

export async function agentHttp(req: Request, env: Bindings, url: URL) {
  const resource = url.origin + "/mcp",
    metadata = url.origin + "/.well-known/oauth-protected-resource/mcp";
  if (url.pathname === "/.well-known/oauth-protected-resource/mcp" && req.method === "GET")
    return Response.json({
      resource,
      authorization_servers: [url.origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mail.read", "mail.write", "admin"],
    });
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) throw new Problem(403, "Cross-origin request denied");
    const upload = /^\/v1\/uploads\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
    if (upload) return await receiveUpload(env, req, upload[1], url);
    const c = await authenticateAgent(env, req);
    if (url.pathname === "/mcp") return await mcp(req, env, c);
    if (url.pathname === "/v1/openapi.json" && req.method === "GET") {
      const paths = Object.fromEntries(
        catalog
          .filter((op) => permits(c.scopes, op.scope))
          .map((op) => [
            "/v1/" + op.name,
            {
              post: {
                operationId: op.name,
                summary: op.description,
                security: [{ bearer: [] }],
                requestBody: {
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: Object.fromEntries(op.fields.map((k) => [k, {}])),
                      },
                    },
                  },
                },
                responses: {
                  200: { description: "Operation outcome" },
                  403: { description: "Insufficient permissions" },
                },
              },
            },
          ]),
      );
      return Response.json({
        openapi: "3.1.0",
        info: { title: "Edge Mail", version: "1" },
        servers: [{ url: url.origin }],
        paths,
        components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
      });
    }
    if (req.method !== "POST") throw new Problem(405, "Use POST with a JSON object");
    const match = /^\/v1\/([a-z_]+)$/.exec(url.pathname);
    if (!match) throw new Problem(404, "Unknown operation");
    const data = await readJson(req, 65536);
    return Response.json(await executeOperation(env, c, match[1], data));
  } catch (error) {
    if (!(error instanceof Problem)) throw error;
    return Response.json(
      { error: error.status === 401 ? "invalid_token" : error.message },
      {
        status: error.status,
        headers:
          error.status === 401 || error.message === "insufficient_scope"
            ? {
                "WWW-Authenticate": `Bearer resource_metadata="${metadata}", error="${error.status === 401 ? "invalid_token" : "insufficient_scope"}"`,
              }
            : {},
      },
    );
  }
}
