import type { Bindings } from "./env";
import { separator } from "./wire";

// These indicators describe the MIME wrapper. They make no claim about signature validity.
export function mailProtection(contentType: string, text: string) {
  const [mime, ...parameters] = contentType
    .toLowerCase()
    .split(";")
    .map((p) => p.trim());
  const parameter = (name: string) =>
    parameters
      .find((p) => p.split("=")[0]?.trim() === name)
      ?.split("=")[1]
      ?.trim()
      .replace(/^"|"$/g, "");
  if (
    mime === "multipart/encrypted" ||
    /^-----BEGIN PGP MESSAGE-----\r?$/m.test(text.slice(0, 128).trimStart().split("\n")[0] || "")
  )
    return "encrypted";
  if (
    mime === "multipart/signed" ||
    text.trimStart().startsWith("-----BEGIN PGP SIGNED MESSAGE-----")
  )
    return "signed";
  if (/^application\/(x-)?pkcs7-mime$/.test(mime || "")) {
    if (parameter("smime-type") === "signed-data") return "signed";
    if (
      parameter("smime-type") === "enveloped-data" ||
      parameter("smime-type") === "authenveloped-data"
    )
      return "encrypted";
  }
  return "none";
}

export async function storedProtection(env: Bindings, key: string | null, known?: string) {
  if (known || !key) return known || "none";
  const raw = await env.MAIL.get(key, { range: { offset: 0, length: 131072 } });
  if (!raw) return "none";
  const bytes = new Uint8Array(await raw.arrayBuffer()),
    end = separator(bytes);
  if (end < 0) return "none";
  const decoder = new TextDecoder();
  const headers = decoder.decode(bytes.subarray(0, end)).replace(/\r?\n[ \t]+/g, " ");
  const field = /^content-type:[ \t]*([^\r\n]+)/im.exec(headers)?.[1] || "";
  return mailProtection(field, decoder.decode(bytes.subarray(end, end + 128)));
}
