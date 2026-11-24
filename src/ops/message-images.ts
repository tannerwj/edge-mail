import sanitize from "sanitize-html";
import { contentKey } from "../instance-key";
import { signTicket, readTicket } from "../content-ticket";
import { publicFetch, publicUrl } from "../public-fetch";
import { rasterType } from "../raster";
import { type Bindings, Problem } from "../env";

export const htmlKey = (box: string, message: string) => "html/" + box + "/" + message;
export const htmlLimit = 2 * 1024 * 1024;
export function findImages(html: string) {
  const images = new Set<string>();
  sanitize(html, {
    allowedTags: [],
    allowedAttributes: {},
    transformTags: {
      img: (tag, attrs) => {
        if (images.size < 24 && attrs.src) {
          try {
            images.add(publicUrl(attrs.src).href);
          } catch {
            /* Unusable mail images remain hidden. */
          }
        }
        return { tagName: tag, attribs: {} };
      },
    },
  });
  return [...images];
}
export async function imageSettings(
  env: Bindings,
  user: string,
  box: string,
  message: string,
  mode?: unknown,
) {
  const row = await env.DB.prepare(
    `SELECT lower(m.sender) AS sender,EXISTS(SELECT 1 FROM deliveries d WHERE d.message_id=m.id AND json_extract(d.auth,'$.dmarc')='pass') AS verified,EXISTS(SELECT 1 FROM sender_images s WHERE s.mailbox_id=m.mailbox_id AND s.address=lower(m.sender) AND s.user_id=?) AS saved FROM messages m WHERE m.mailbox_id=? AND m.id=?`,
  )
    .bind(user, box, message)
    .first<{ sender: string; verified: number; saved: number }>();
  if (!row) throw new Problem(404, "Message unavailable");
  if (mode === "always") {
    if (!row.verified) throw new Problem(400, "This sender could not be verified");
    await env.DB.prepare("INSERT OR IGNORE INTO sender_images VALUES(?,?,?)")
      .bind(box, row.sender, user)
      .run();
    row.saved = 1;
  } else if (mode === "block") {
    await env.DB.prepare("DELETE FROM sender_images WHERE mailbox_id=? AND address=? AND user_id=?")
      .bind(box, row.sender, user)
      .run();
    row.saved = 0;
  }
  return { trusted: !!(row.saved && row.verified), verified: !!row.verified };
}
export async function withImages(
  env: Bindings,
  html: string,
  base: sanitize.IOptions,
  target: { box: string; message: string; user: string; expires: number },
) {
  const urls = findImages(html);
  const urlsToTickets = new Map<string, string>();
  const key = await contentKey(env, false);
  await Promise.all(
    urls.map(async (url, n) => {
      const { href } = await signTicket(env, "img", target, { n, exp: target.expires }, key);
      urlsToTickets.set(url, href);
    }),
  );
  return sanitize(html, {
    ...base,
    allowedTags: [...(base.allowedTags || []), "img"],
    allowedAttributes: { ...base.allowedAttributes, img: ["src", "alt", "loading"] },
    transformTags: {
      ...base.transformTags,
      img: (_tag, attrs): sanitize.Tag => {
        let src;
        try {
          src = urlsToTickets.get(new URL(attrs.src).href);
        } catch {
          /* Relative paths lack a sender origin. */
        }
        return src
          ? {
              tagName: "img",
              attribs: { src, alt: (attrs.alt || "").slice(0, 300), loading: "lazy" },
            }
          : { tagName: "span", attribs: {} };
      },
    },
  });
}
export async function renderImage(env: Bindings, token: string, headers: Headers, method: string) {
  const { box, message, payload } = await readTicket(env, "img", token);
  const n = payload.n;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n >= 24)
    throw Error("Unknown image");
  const html = await env.MAIL.get(htmlKey(box, message));
  if (!html || html.size > htmlLimit) throw Error("Source unavailable");
  const url = findImages(await html.text())[n];
  if (!url) throw Error("Image unavailable");
  const { data, type } = await publicFetch(url, {
    headers: { Accept: "image/png,image/jpeg,image/gif" },
    limit: 2 * 1024 * 1024,
  });
  if (!type || rasterType(data.buffer) !== type) throw Error("Unsupported image format");
  headers.set("Content-Type", type);
  headers.set("Content-Length", String(data.byteLength));
  return new Response(method === "HEAD" ? null : data, { headers });
}
