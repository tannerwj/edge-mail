import type { Bindings } from "./env";

export async function transportPolicy(req: Request, env: Bindings, url: URL) {
  if (url.pathname !== "/.well-known/mta-sts.txt") return new Response(null, { status: 404 });
  if (req.method !== "GET" && req.method !== "HEAD")
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const obj = await env.MAIL.get("instance/transport/" + url.hostname.slice(8) + ".txt");
  if (!obj) return new Response(null, { status: 404 });
  return new Response(req.method === "HEAD" ? null : obj.body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
