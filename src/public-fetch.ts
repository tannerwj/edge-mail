// All installations enable global_fetch_strictly_public so the connection also uses public egress.
import ipaddr from "ipaddr.js";
import { lookup } from "./dns";
export function publicUrl(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.href.length > 4096
  )
    throw Error("Public HTTPS endpoint required");
  const host = url.hostname;
  if (
    !host.includes(".") ||
    host.endsWith(".") ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    ipaddr.isValid(host)
  )
    throw Error("Public DNS name required");
  return url;
}
async function publicHost(host: string) {
  const replies = await Promise.all([lookup(host, "A", 1), lookup(host, "AAAA", 28)]);
  const addresses = replies.flat();
  if (!addresses.length || !addresses.every((s) => ipaddr.parse(s).range() === "unicast"))
    throw Error("Public address required");
}
async function bounded(response: Response, max: number) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw Error("Response exceeds limit");
    }
    chunks.push(next.value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const value of chunks) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}
export async function publicFetch(
  input: string,
  options: { headers?: Record<string, string>; body?: string; limit: number },
) {
  let url = publicUrl(input);
  const signal = AbortSignal.timeout(7000);
  for (let step = 0; step < 4; step++) {
    await publicHost(url.hostname);
    const res = await fetch(url, {
      method: options.body === undefined ? "GET" : "POST",
      headers: options.headers,
      body: options.body,
      redirect: "manual",
      signal,
      cache: "no-store",
    });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const location = res.headers.get("location");
      if (!location || options.body !== undefined) throw Error("Endpoint redirected");
      url = publicUrl(new URL(location, url).href);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw Error("Endpoint unavailable");
    }
    return {
      data: await bounded(res, options.limit),
      type: (res.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase(),
    };
  }
  throw Error("Too many redirects");
}
