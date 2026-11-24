import * as z from "zod/mini";
import { Problem } from "./env";
const answer = z.object({
  Status: z.number(),
  Answer: z.optional(z.array(z.object({ type: z.number(), data: z.string() }))),
});
export async function lookup(name: string, type: string, code: number) {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.search = new URLSearchParams({ name, type }).toString();
  try {
    const response = await fetch(url, {
      headers: { accept: "application/dns-json" },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw Error();
    const dns = answer.parse(await response.json());
    if (![0, 3].includes(dns.Status)) throw Error();
    return (dns.Answer || []).filter((r) => r.type === code).map((r) => r.data);
  } catch {
    throw new Problem(503, "Public DNS is unavailable. Retry the domain check.");
  }
}
