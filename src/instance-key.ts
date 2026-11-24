import { Buffer } from "node:buffer";
import type { Bindings } from "./env";

const decode = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
const text = new TextEncoder();
async function wrappingKey(secret: string) {
  const material = await crypto.subtle.importKey("raw", text.encode(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: text.encode("edge-mail instance keys v1"),
      info: text.encode("AES-GCM wrapping"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
type Envelope = { ciphertext: string; iv: string };
async function wrap(env: Bindings, context: string, data: Uint8Array) {
  if (!env.SETUP_TOKEN) throw Error("Instance wrapping key missing");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: text.encode(context) },
    await wrappingKey(env.SETUP_TOKEN),
    data,
  );
  return {
    iv: Buffer.from(iv).toString("base64url"),
    ciphertext: Buffer.from(cipher).toString("base64url"),
  };
}
async function unwrap(env: Bindings, context: string, item: Envelope) {
  if (!env.SETUP_TOKEN) throw Error("Instance wrapping key missing");
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(item.iv), additionalData: text.encode(context) },
    await wrappingKey(env.SETUP_TOKEN),
    decode(item.ciphertext),
  );
}
export const seal = (env: Bindings, context: string, plaintext: string) =>
  wrap(env, context, text.encode(plaintext));
export async function unseal(env: Bindings, context: string, item: Envelope) {
  return new TextDecoder().decode(await unwrap(env, context, item));
}
export async function contentKey(env: Bindings, create: boolean) {
  const name = "content-signing-v1";
  const select = env.DB.prepare("SELECT ciphertext,iv FROM instance_keys WHERE name=?").bind(name);
  let saved = await select.first<Envelope>();
  if (!saved && create) {
    const value = await wrap(env, name, crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare(
      "INSERT INTO instance_keys(name,ciphertext,iv) VALUES(?,?,?) ON CONFLICT DO NOTHING",
    )
      .bind(name, value.ciphertext, value.iv)
      .run();
    saved = await select.first<Envelope>();
  }
  if (!saved) throw Error("Content key unavailable");
  return crypto.subtle.importKey(
    "raw",
    await unwrap(env, name, saved),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
