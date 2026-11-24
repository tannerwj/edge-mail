import {
  findImages,
  withImages,
  imageSettings,
  htmlLimit as limit,
  htmlKey,
} from "./message-images";
import PostalMime from "postal-mime";
import sanitize from "sanitize-html";
import { issueTicket, permitted, readTicket } from "../content-ticket";
import { type Bindings, Problem } from "../env";
import { MAX_RAW } from "./receipt";

export async function formatted(
  env: Bindings,
  user: string,
  box: string,
  message: string,
  app: string,
  mode?: unknown,
) {
  const mail = await permitted(env, user, box, message);
  if (!mail?.raw_key) throw new Problem(404, "Message unavailable");
  const key = htmlKey(box, message);
  let object = await env.MAIL.get(key);
  if (!object) {
    const raw = await env.MAIL.get(mail.raw_key);
    if (!raw || raw.size > MAX_RAW) throw new Problem(503, "Original message unavailable");
    const { html } = await PostalMime.parse(await raw.arrayBuffer());
    if (!html) return { href: null };
    if (new TextEncoder().encode(html).length > limit)
      throw new Problem(413, "Formatted body is too large. Use the text view.");
    await env.MAIL.put(key, html, { onlyIf: { etagDoesNotMatch: "*" } });
    object = await env.MAIL.get(key);
  }
  if (!object || object.size > limit) throw new Problem(503, "Formatted body unavailable");
  const count = findImages(await object.text()).length;
  const settings = await imageSettings(env, user, box, message, mode);
  const showing = !!count && (mode === "once" || settings.trusted);
  return {
    ...(await issueTicket(env, "html", user, box, message, { app, images: Number(showing) })),
    count,
    showing,
    ...settings,
  };
}
const color = [/^#[a-f0-9]{3,8}$/i, /^[a-z]{1,20}$/i];
const dimension = [/^\d{1,3}(?:px|%|pt)$/i];
const rules: sanitize.IOptions = {
  allowedTags:
    "p div span a br hr table thead tbody tfoot tr td th h1 h2 h3 h4 h5 h6 ul ol li strong b em i u s blockquote pre code sub sup small".split(
      " ",
    ),
  allowedAttributes: {
    "*": ["style", "dir"],
    a: ["data-mail-url", "role", "tabindex"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
  },
  transformTags: {
    a: (_tag, attrs): sanitize.Tag => {
      try {
        const url = new URL(attrs.href);
        if (["https:", "http:", "mailto:"].includes(url.protocol))
          return {
            tagName: "a",
            attribs: { "data-mail-url": url.href, role: "link", tabindex: "0" },
          };
      } catch {
        /* Relative links have no trustworthy mail base. */
      }
      return { tagName: "span", attribs: {} };
    },
  },
  allowedSchemes: ["https", "http", "mailto"],
  allowProtocolRelative: false,
  nonTextTags: [
    "script",
    "style",
    "textarea",
    "option",
    "iframe",
    "noscript",
    "svg",
    "math",
    "template",
    "form",
    "object",
  ],
  allowedStyles: {
    "*": {
      color,
      "background-color": color,
      "font-size": dimension,
      "text-align": [/^(left|right|center|justify)$/],
      "font-style": [/^(normal|italic)$/],
      "font-weight": [/^(normal|bold|[1-9]00)$/],
      "text-decoration": [/^(none|underline|line-through)$/],
      width: dimension,
      "max-width": dimension,
      padding: dimension,
    },
  },
  nestingLimit: 80,
};
const helper = `const report=()=>parent.postMessage({kind:"mail-height",height:document.body.scrollHeight}, window.mailParent);
new ResizeObserver(report).observe(document.body);report();
document.addEventListener("click",e=>{const a=e.target.closest("a");if(!a)return;e.preventDefault();const href=a.getAttribute("data-mail-url");if(href)parent.postMessage({kind:"mail-link",href},window.mailParent)});
document.addEventListener("keydown",e=>{if(e.key==="Enter" && e.target.matches("a[data-mail-url]"))e.target.click()});`;
export async function renderFormatted(
  env: Bindings,
  token: string,
  headers: Headers,
  method: string,
) {
  const target = await readTicket(env, "html", token);
  const { box, message, payload } = target;
  const app = payload.app;
  if (typeof app !== "string" || new URL(app).origin !== app || !/^https?:\/\//.test(app))
    throw Error("Invalid parent");
  const raw = await env.MAIL.get(htmlKey(box, message));
  if (!raw || raw.size > limit) throw Error("Body unavailable");
  const nonce = crypto.randomUUID().replaceAll("-", "");
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; img-src ${env.CONTENT_ORIGIN}/img/; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; sandbox allow-scripts; frame-ancestors ${app}`,
  );
  const html = method === "HEAD" ? "" : await raw.text();
  const clean =
    payload.images === 1 ? await withImages(env, html, rules, target) : sanitize(html, rules);
  const page =
    method === "HEAD"
      ? null
      : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui;margin:0;overflow-wrap:anywhere}a[role=link]{color:LinkText;text-decoration:underline;cursor:pointer}table,img{max-width:100%}img{height:auto}pre{white-space:pre-wrap}</style></head><body>${clean}<script nonce="${nonce}">window.mailParent=${JSON.stringify(app)};${helper}</script></body></html>`;
  return new Response(page, { headers });
}
