import * as z from "zod/mini";
import { Problem, type Bindings, requireValue } from "../env";
import { administrator, type User } from "./access";
import { mappings } from "./identities";
const item = z.object({
  id: z.string(),
  email: z.string(),
  read_only: z.boolean(),
  reason: z.string(),
  created_at: z.string(),
  expires_at: z.nullable(z.string()),
  scope: z.object({ type: z.string(), value: z.optional(z.string()) }),
});
function domains(env: Bindings) {
  return [...new Set(mappings(env).map((m) => m.from.split("@")[1]))].sort();
}
function endpoint(env: Bindings) {
  if (
    !env.SUPPRESSION_API_TOKEN ||
    !env.MAIL_ACCOUNT_ID ||
    !/^[0-9a-f]{32}$/.test(env.MAIL_ACCOUNT_ID)
  )
    throw new Problem(503, "Suppression management is unavailable");
  return (
    "https://api.cloudflare.com/client/v4/accounts/" +
    env.MAIL_ACCOUNT_ID +
    "/email/sending/suppressions"
  );
}
async function provider(env: Bindings, path: string, method = "GET") {
  const response = await fetch(endpoint(env) + path, {
    method,
    headers: { Authorization: "Bearer " + env.SUPPRESSION_API_TOKEN },
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    throw new Problem(503, "Cloudflare suppression service is unavailable");
  });
  if (response.status === 404) throw new Problem(404, "Suppression no longer exists");
  if (!response.ok) throw new Problem(503, "Cloudflare could not complete the suppression request");
  return response;
}
export async function suppressionList(env: Bindings, u: User, url: URL) {
  administrator(u);
  const available = domains(env),
    domain = url.searchParams.get("domain") ?? available[0];
  if (!domain || !env.SUPPRESSION_API_TOKEN || !env.MAIL_ACCOUNT_ID)
    return { available: false, domains: available, items: [], next: null };
  if (!available.includes(domain)) throw new Problem(403, "Choose an instance sending domain");
  const params = new URLSearchParams({
    scope_type: "sending_domain",
    scope_value: domain,
    per_page: "25",
  });
  const cursor = url.searchParams.get("cursor");
  if (cursor) params.set("cursor", requireValue(cursor, 2048));
  const data = z
    .object({
      success: z.literal(true),
      result: z.array(item),
      result_info: z.object({ next_cursor: z.optional(z.nullable(z.string())) }),
    })
    .parse(await (await provider(env, "?" + params)).json());
  return {
    available: true,
    domains: available,
    items: data.result.filter((r) => r.scope.type === "sending_domain" && r.scope.value === domain),
    next: data.result_info.next_cursor ?? null,
  };
}
export async function removeSuppression(env: Bindings, u: User, a: Record<string, unknown>) {
  if (u.role !== "owner") throw new Problem(403, "Instance owner required");
  const id = requireValue(a.id, 36);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
    throw new Problem(400, "Choose a suppression");
  const entry = z
    .object({ success: z.literal(true), result: item })
    .parse(await (await provider(env, "/" + id)).json()).result;
  if (
    entry.id !== id ||
    entry.read_only ||
    entry.scope.type !== "sending_domain" ||
    !domains(env).includes(entry.scope.value || "")
  )
    throw new Problem(403, "Suppression cannot be removed from this instance");
  if (a.email !== entry.email || a.domain !== entry.scope.value)
    throw new Problem(409, "Review the current suppression before removing it");
  if (
    !(await env.DB.prepare(
      "SELECT 1 FROM users WHERE id=? AND role='owner' AND disabled_at IS NULL",
    )
      .bind(u.id)
      .first())
  )
    throw new Problem(403, "Instance owner required");
  await (await provider(env, "/" + id, "DELETE")).body?.cancel();
  return { removed: true };
}
