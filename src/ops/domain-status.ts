import { lookup } from "../dns";
import * as z from "zod/mini";
import { canManageDomain } from "./access";
import { Problem, type Bindings, type Principal } from "../env";
async function routeReceipt(env: Bindings, domain: string, kind: string) {
  const stored = await env.MAIL.get("instance/routes/" + domain + "/" + kind + ".json");
  return stored
    ? z.object({ checked: z.string(), addresses: z.array(z.string()) }).parse(await stored.json())
    : null;
}
function txt(r: string) {
  return r.replace(/"\s+"/g, "").replace(/^"|"$/g, "");
}
export async function domainStatus(env: Bindings, user: Principal, id: string) {
  await canManageDomain(env, user, id);
  const domain = await env.DB.prepare("SELECT name FROM domains WHERE id=?")
    .bind(id)
    .first<string>("name");
  if (!domain) throw new Problem(404, "Domain unavailable");
  const [mx, records, policy, ip4, ip6] = await Promise.all([
    lookup(domain, "MX", 15),
    lookup(domain, "TXT", 16),
    lookup("_dmarc." + domain, "TXT", 16),
    lookup(domain, "A", 1),
    lookup(domain, "AAAA", 28),
  ]);
  const nullMX = mx.length === 1 && /^0\s+\.$/.test(mx[0]);
  const implicit = !mx.length && !!(ip4.length + ip6.length);
  const foreign = mx.some((r) => !/^\d+\s+route\d+\.mx\.cloudflare\.net\.?$/i.test(r));
  const state = nullMX
    ? "declines"
    : implicit || foreign
      ? "cutover"
      : mx.length
        ? "cloudflare"
        : "unused";
  const catalog = await env.MAIL.get("instance/zone-catalog.json");
  const installation = catalog
    ? z
        .object({
          zones: z.optional(z.array(z.object({ name: z.string() }))),
          worker: z.optional(z.string().check(z.regex(/^[a-z0-9-]+$/))),
        })
        .safeParse(await catalog.json())
    : null;
  const [exact, apex, mail] = await Promise.all([
    routeReceipt(env, domain, "exact"),
    routeReceipt(env, domain, "apex"),
    env.DB.prepare(`SELECT b.address,
      (SELECT max(d.received_at) FROM deliveries d WHERE d.mailbox_id=b.id AND d.kind!='import') inbound,
      (SELECT max(o.created_at) FROM outbox o WHERE o.mailbox_id=b.id AND o.state='sent' AND o.provider!='capture') outbound,
      (SELECT max(o.created_at) FROM outbox o WHERE o.mailbox_id=b.id AND o.state='sent' AND o.provider='capture') captured
      FROM mailboxes b WHERE b.domain_id=?`)
      .bind(id)
      .all(),
  ]);
  return {
    progress: mail.results.map((m) => ({
      ...m,
      route: exact?.addresses.includes(String(m.address))
        ? exact.checked
        : apex?.addresses.includes("*")
          ? apex.checked
          : null,
    })),
    apex: installation?.success && !!installation.data.zones?.some((zone) => zone.name === domain),
    worker: (installation?.success && installation.data.worker) || env.INSTALL_WORKER,
    domain,
    state,
    mx,
    spf: records.map(txt).filter((r) => /^v=spf1(?:\s|$)/i.test(r)),
    dmarc: policy.map(txt).filter((r) => /^v=DMARC1(?:;|$)/i.test(r)),
  };
}
