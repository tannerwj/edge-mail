import { Buffer } from "node:buffer";
export function rasterType(bytes: ArrayBuffer) {
  const head = Buffer.from(bytes, 0, Math.min(bytes.byteLength, 12)).toString("hex");
  if (head.startsWith("89504e470d0a1a0a")) return "image/png";
  if (head.startsWith("ffd8ff")) return "image/jpeg";
  if (head.startsWith("474946383761") || head.startsWith("474946383961")) return "image/gif";
  return null;
}
