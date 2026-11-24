import * as z from "zod/mini";
import { type Bindings } from "../env";
import { readJson } from "../request-json";
import { type Credential } from "./grants";
import { runCode } from "./code-mode";

const call = z.object({
  name: z.enum(["search", "execute"]),
  arguments: z.record(z.string(), z.unknown()),
});
const tools = ["search", "execute"].map((name) => ({
  name,
  description:
    name === "search"
      ? "Search the scope-filtered operations array with an async arrow function."
      : "Run an async arrow function using mail operations.",
  inputSchema: {
    type: "object",
    properties: { code: { type: "string" }, dry_run: { type: "boolean" } },
    required: ["code"],
    additionalProperties: false,
  },
}));
export async function mcp(req: Request, env: Bindings, c: Credential) {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const msg = await readJson(req, 32768);
  const id = msg.id;
  const error = (code: number, message: string) =>
    Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string")
    return error(-32600, "Invalid JSON-RPC request");
  if (id === undefined) return new Response(null, { status: 202 });
  let result: unknown;
  switch (msg.method) {
    case "initialize": {
      const requested = z.object({ protocolVersion: z.string() }).safeParse(msg.params);
      const v = requested.success ? requested.data.protocolVersion : "";
      result = {
        protocolVersion: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"].includes(v)
          ? v
          : "2026-07-28",
        capabilities: { tools: {} },
        serverInfo: { name: "edge-mail", version: "1" },
      };
      break;
    }
    case "ping":
      result = {};
      break;
    case "server/discover":
      result = {
        serverInfo: { name: "edge-mail", version: "1" },
        capabilities: { tools: {} },
        tools,
      };
      break;
    case "tools/list":
      result = { tools };
      break;
    case "tools/call": {
      const parsed = call.safeParse(msg.params);
      if (!parsed.success) return error(-32602, "Invalid tool arguments");
      const { name, arguments: args } = parsed.data;
      const r = await runCode(env, c, name, args);
      result = {
        isError: r.isError,
        content: [{ type: "text", text: JSON.stringify(r) }],
        structuredContent: r,
      };
      break;
    }
    default:
      return error(-32601, "Method unavailable");
  }
  return Response.json({ jsonrpc: "2.0", id, result });
}
