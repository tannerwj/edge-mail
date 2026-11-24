import { issueTicket, readTicket } from "../content-ticket";
import { Problem, type Bindings } from "../env";
import { rasterType } from "../raster";

const limit = 8 * 1024 * 1024;
export function previewType(data: ArrayBuffer, size: number) {
  if (size > limit) return null;
  if (new TextDecoder().decode(data.slice(0, 5)) === "%PDF-") return "application/pdf";
  return rasterType(data);
}
export async function previewTicket(
  env: Bindings,
  user: string,
  box: string,
  id: string,
  part: number,
  type: string | null | undefined,
) {
  if (!type) throw new Problem(404, "Preview unavailable");
  return issueTicket(env, "preview", user, box, id, { n: part });
}
export async function renderPreview(env: Bindings, token: string, h: Headers, method: string) {
  const { box, message, payload } = await readTicket(env, "preview", token);
  if (typeof payload.n !== "number" || !Number.isSafeInteger(payload.n) || payload.n < 0)
    throw Error("Invalid attachment");
  const file = await env.MAIL.get("att/" + box + "/" + message + "/" + payload.n);
  if (!file || file.size > limit) throw Error("Attachment unavailable");
  const bytes = await file.arrayBuffer(),
    type = previewType(bytes, bytes.byteLength);
  if (!type) throw Error("Unsupported file");
  h.set("Content-Disposition", "inline");
  h.set("Content-Type", type);
  h.set("Content-Length", String(file.size));
  return new Response(method === "HEAD" ? null : bytes, { headers: h });
}
