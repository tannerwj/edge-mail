import * as z from "zod/mini";
import { Problem, type Bindings } from "../env";
import { owning } from "./mailbox-owner";
const entry = z.object({ email: z.string(), verified: z.optional(z.nullable(z.string())) });
export function canVerifyDestination(env: Bindings) {
  return !!env.ROUTING_ADDRESS_TOKEN && /^[0-9a-f]{32}$/.test(env.MAIL_ACCOUNT_ID || "");
}
async function call(env: Bindings, path: string, address?: string) {
  const response = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/" +
      env.MAIL_ACCOUNT_ID +
      "/email/routing/addresses" +
      path,
    {
      method: address ? "POST" : "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
      headers: {
        Authorization: "Bearer " + env.ROUTING_ADDRESS_TOKEN,
        ...(address ? { "Content-Type": "application/json" } : {}),
      },
      ...(address ? { body: JSON.stringify({ email: address }) } : {}),
    },
  ).catch(() => {
    throw new Problem(503, "Cloudflare destination verification is unavailable");
  });
  if (!response.ok)
    throw new Problem(503, "Cloudflare could not confirm the destination. Check its status again.");
  return response.json();
}
async function providerDestination(env: Bindings, address: string) {
  const schema = z.object({
    result: z.array(entry),
    success: z.literal(true),
    result_info: z.optional(z.object({ total_pages: z.number() })),
  });
  for (let n = 1; n <= 25; n++) {
    const page = schema.parse(await call(env, "?per_page=50&page=" + n));
    const found = page.result.find((r) => r.email.toLowerCase() === address);
    if (found) return found;
    if (n >= (page.result_info?.total_pages ?? Infinity) || page.result.length < 50) return null;
  }
  throw new Problem(503, "Use destination:verify for larger account directories");
}
export async function verifyDestination(env: Bindings, actor: string, box: string, id: unknown) {
  if (!canVerifyDestination(env))
    throw new Problem(503, "Use the verification command for this installation");
  const db = env.DB,
    params = [String(id), actor, box];
  const where = " WHERE id=? AND disabled=0 AND mailbox_id IN (" + owning + ")";
  const row = await db
    .prepare("SELECT address,verified_at FROM egress_destinations" + where)
    .bind(...params)
    .first<{ address: string; verified_at: string | null }>();
  if (!row) throw new Problem(404, "Destination unavailable");
  let found = await providerDestination(env, row.address);
  // A missing previously verified address must lose its local verification before it can be registered again.
  if (!found && !row.verified_at) {
    if (
      !(await db
        .prepare("SELECT 1 FROM egress_destinations" + where + " AND address=?")
        .bind(...params, row.address)
        .first())
    )
      throw new Problem(409, "Destination changed");
    found = z
      .object({ success: z.literal(true), result: entry })
      .parse(await call(env, "", row.address)).result;
  }
  if (found && found.email.toLowerCase() !== row.address)
    throw new Problem(503, "Unexpected destination response");
  const verified =
    found?.verified && Number.isFinite(Date.parse(found.verified)) ? found.verified : null;
  const result = await db
    .prepare("UPDATE egress_destinations SET verified_at=?" + where + " AND address=?")
    .bind(verified, ...params, row.address)
    .run();
  if (!result.meta.changes) throw new Problem(409, "Destination changed");
  return { verified_at: verified };
}
