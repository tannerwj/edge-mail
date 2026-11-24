import { previewType, previewTicket, renderPreview } from "./file-preview";
import { renderImage } from "./message-images";
import PostalMime from "postal-mime";
import { issueTicket, readTicket, permitted } from "../content-ticket";
import { renderFormatted } from "./formatted";
import { type Bindings, Problem } from "../env";
import { MAX_RAW } from "./receipt";

type FileEntry = {
  name: string;
  size: number;
  risk: boolean;
  calendar?: boolean;
  preview?: string | null;
};
const prefix = (box: string, message: string) => "att/" + box + "/" + message + "/";
async function files(env: Bindings, path: string, rawKey: string) {
  const key = path + "index.json",
    cached = await env.MAIL.get(key);
  if (cached) {
    const entries = await cached.json<FileEntry[]>();
    if (entries.every((entry) => entry.preview !== undefined)) return entries;
  }
  const raw = await env.MAIL.get(rawKey);
  if (!raw || raw.size > MAX_RAW) throw new Problem(503, "Original message unavailable");
  const mail = await PostalMime.parse(await raw.arrayBuffer(), {
    attachmentEncoding: "arraybuffer",
  });
  const items: FileEntry[] = [];
  for (const part of mail.attachments) {
    if (typeof part.content === "string") throw new Problem(503, "Attachment decoding failed");
    const name =
      (part.filename || "attachment")
        .split(/[\\/]/)
        .at(-1)
        ?.replace(/[\p{Cc}\p{Cf}]/gu, "")
        .trim()
        .slice(0, 180) || "attachment";
    const risk =
      /\.(exe|com|msi|bat|cmd|ps1|js|vbs|scr|jar|html?|svg|lnk|docm|xlsm|app|dmg)$/i.test(name);
    await env.MAIL.put(path + items.length, part.content, { onlyIf: { etagDoesNotMatch: "*" } });
    items.push({
      name,
      size: part.content.byteLength,
      risk,
      preview: risk
        ? null
        : previewType(
            part.content instanceof ArrayBuffer
              ? part.content
              : new Uint8Array(part.content).buffer,
            part.content.byteLength,
          ),
      calendar: part.mimeType.toLowerCase() === "text/calendar" || /\.ics$/i.test(name),
    });
  }
  await env.MAIL.put(key, JSON.stringify(items));
  return items;
}
export async function sourcePart(
  env: Bindings,
  user: string,
  box: string,
  message: string,
  n: number,
) {
  const target = await permitted(env, user, box, message);
  if (!target?.raw_key || n < 0) throw new Problem(404, "Attachment unavailable");
  const path = prefix(box, message),
    list = await files(env, path, target.raw_key),
    entry = list[n];
  if (!entry) throw new Problem(404, "Attachment unavailable");
  return {
    key: path + n,
    name: entry.name,
    size: entry.size,
    calendar: entry.calendar ?? /\.ics$/i.test(entry.name),
  };
}
export async function calendarPreview(
  env: Bindings,
  user: string,
  box: string,
  id: string,
  n: string | null,
) {
  if (n === null || !/^(0|[1-9]\d*)$/.test(n))
    throw new Problem(404, "Calendar attachment unavailable");
  const part = await sourcePart(env, user, box, id, Number(n));
  if (!part.calendar) throw new Problem(404, "Calendar attachment unavailable");
  if (part.size > 128 * 1024) throw new Problem(413, "Download this calendar to view it");
  const file = await env.MAIL.get(part.key);
  if (!file || file.size > 128 * 1024) throw new Problem(404, "Calendar attachment unavailable");
  return { calendar: await file.text() };
}
export async function attachments(
  env: Bindings,
  user: string,
  box: string,
  message: string,
  part: string | null,
  access?: { grant: string; audience: string; expires: number } | "preview",
) {
  const target = await permitted(env, user, box, message);
  if (!target) throw new Problem(404, "Message unavailable");
  if (!target.attachment_count || !target.raw_key) return { files: [] };
  if (!env.CONTENT_ORIGIN) throw new Problem(503, "Content host unavailable");
  const list = await files(env, prefix(box, message), target.raw_key);
  if (part === null) return { files: list.map((f, index) => ({ ...f, part: index })) };
  if (!/^(0|[1-9][0-9]*)$/.test(part) || !list[Number(part)])
    throw new Problem(404, "File unavailable");
  if (access === "preview")
    return previewTicket(env, user, box, message, Number(part), list[Number(part)].preview);
  return issueTicket(env, "file", user, box, message, {
    ...(access
      ? {
          grant: access.grant,
          app: access.audience,
          exp: Math.floor(access.expires / 1000),
        }
      : {}),
    n: Number(part),
  });
}
async function redeem(env: Bindings, token: string) {
  const { box, message, payload } = await readTicket(env, "file", token);
  const n = payload.n;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) throw Error("Invalid file");
  const path = prefix(box, message),
    manifest = await env.MAIL.get(path + "index.json");
  const entry = (await manifest?.json<FileEntry[]>())?.[n];
  if (!entry) throw Error("File unavailable");
  const object = await env.MAIL.get(path + n);
  if (!object) throw Error("File unavailable");
  return { entry, object };
}
export async function contentResponse(req: Request, env: Bindings) {
  const h = new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000",
  });
  const path = new URL(req.url).pathname;
  if (!["HEAD", "GET"].includes(req.method)) return new Response(null, { status: 404, headers: h });
  try {
    if (path.startsWith("/preview/")) return await renderPreview(env, path.slice(9), h, req.method);
    if (path.startsWith("/img/")) return await renderImage(env, path.slice(5), h, req.method);
    if (path.startsWith("/html/")) return await renderFormatted(env, path.slice(6), h, req.method);
    if (!path.startsWith("/file/")) return new Response(null, { status: 404, headers: h });
    const { entry, object } = await redeem(env, path.slice(6));
    h.set(
      "Content-Disposition",
      "attachment; filename*=UTF-8''" +
        encodeURIComponent(entry.name).replace(
          /['()*]/g,
          (c) => "%" + c.charCodeAt(0).toString(16),
        ),
    );
    h.set("Content-Type", "application/octet-stream");
    h.set("Content-Length", String(object.size));
    return new Response(req.method === "HEAD" ? null : object.body, { headers: h });
  } catch {
    return new Response(null, { status: 404, headers: h });
  }
}
