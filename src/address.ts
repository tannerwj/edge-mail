import { domainToASCII } from "node:url";
import { Problem, requireValue } from "./env.ts";

export function domainName(input: unknown) {
  const value = requireValue(input);
  if (/[\s/@:#?%\\]/u.test(value)) throw new Problem(400, "Invalid domain");
  const domain = domainToASCII(value).toLowerCase();
  if (
    !domain.includes(".") ||
    domain.length > 253 ||
    domain.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Problem(400, "Invalid domain");
  return domain;
}
export function address(input: unknown) {
  const original = requireValue(input);
  const [local, domain, extra] = original.split("@");
  if (
    !local ||
    !domain ||
    extra !== undefined ||
    /[\s<>(),:;"\\[\]]/u.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    new TextEncoder().encode(local).length > 64
  )
    throw new Problem(400, "Invalid address");
  const host = domainName(domain);
  const normalized = local.toLowerCase().normalize("NFC");
  if (new TextEncoder().encode(normalized).length > 64) throw new Problem(400, "Invalid address");
  const canonical = normalized + "@" + host;
  if (new TextEncoder().encode(canonical).length > 254) throw new Problem(400, "Address too long");
  return { original, canonical, host, local };
}
