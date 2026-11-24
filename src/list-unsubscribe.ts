import { addressParser } from "postal-mime";

// A pass for a different signature on the same message does not authenticate these fields.
function signatureCovers(value: string, result: string, domain: string) {
  const tags = new Map<string, string>();
  for (const part of value
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean)) {
    const eq = part.indexOf("="),
      name = part.slice(0, eq).toLowerCase();
    if (eq < 1 || tags.has(name)) return false;
    tags.set(name, part.slice(eq + 1).trim());
  }
  const props = new Map<string, string>();
  for (const token of result.trim().split(/\s+/).slice(1)) {
    const match = /^header\.([dsb])=([a-z0-9._+/=-]+)$/i.exec(token);
    if (!match) continue;
    if (props.has(match[1])) return false;
    props.set(match[1], match[2]);
  }
  const prefix = props.get("b") || "",
    signer = tags.get("d")?.toLowerCase();
  const signed = tags
    .get("h")
    ?.toLowerCase()
    .split(":")
    .map((h) => h.trim());
  return (
    signer === domain &&
    props.get("d")?.toLowerCase() === signer &&
    !!props.get("s") &&
    props.get("s") === tags.get("s") &&
    prefix.length >= 8 &&
    tags.get("b")?.replace(/\s+/g, "").startsWith(prefix) &&
    ["from", "list-unsubscribe", "list-unsubscribe-post"].every((h) => signed?.includes(h))
  );
}
function httpsLink(field: string) {
  const links = field.split(",").map((v) => /^\s*<([^<>\s]+)>\s*$/.exec(v)?.[1]);
  if (links.some((v) => !v)) return null;
  const https = links.filter((v): v is string => !!v && /^https:\/\//i.test(v));
  if (https.length !== 1) return null;
  try {
    const u = new URL(https[0]);
    return !u.username && !u.password && !u.port && !u.hash && u.href.length <= 4096 ? u : null;
  } catch {
    return null;
  }
}
export function oneClick(header: string) {
  const fields = new Map<string, string[]>();
  for (const line of header.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) return null;
    const key = line.slice(0, colon).toLowerCase(),
      value = line.slice(colon + 1).trim();
    const prior = fields.get(key);
    if (prior) prior.push(value);
    else fields.set(key, [value]);
  }
  const one = (key: string) => (fields.get(key)?.length === 1 ? fields.get(key)?.[0] : undefined);
  const auth = fields.get("authentication-results")?.[0];
  if (!auth || !/^mx\.cloudflare\.net\s*;/i.test(auth) || /[()"\\]/.test(auth)) return null;
  const results = auth
    .split(";")
    .slice(1)
    .filter((v) => /^\s*dkim=/i.test(v));
  const signature = one("dkim-signature"),
    author = one("from"),
    list = one("list-unsubscribe");
  if (
    !signature ||
    !author ||
    !list ||
    one("list-unsubscribe-post") !== "List-Unsubscribe=One-Click"
  )
    return null;
  const from = addressParser(author);
  const signer = from[0]?.address?.split("@")[1]?.toLowerCase();
  if (from.length !== 1 || !signer || results.length !== 1 || !/^\s*dkim=pass\s/i.test(results[0]))
    return null;
  return signatureCovers(signature, results[0], signer) ? httpsLink(list) : null;
}
