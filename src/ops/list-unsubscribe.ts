import { writable } from "./access";
import { Problem, type Bindings } from "../env";
import { publicFetch, publicUrl } from "../public-fetch";
import { separator } from "../wire";
import { oneClick } from "../list-unsubscribe";
export async function listTarget(env: Bindings, user: string, box: string, id: string) {
  const row = await env.DB.prepare(
    "SELECT d.raw_key FROM deliveries d JOIN messages m ON m.mailbox_id=d.mailbox_id AND m.id=d.message_id WHERE d.mailbox_id IN (" +
      writable +
      ") AND d.message_id=? AND d.kind!='import' AND m.body_key!='erased' AND json_extract(d.auth,'$.dkim')='pass' ORDER BY d.received_at LIMIT 1",
  )
    .bind(user, box, id)
    .first<string>("raw_key");
  if (!row) return null;
  const raw = await env.MAIL.get(row, { range: { offset: 0, length: 131072 } });
  if (!raw) return null;
  const bytes = new Uint8Array(await raw.arrayBuffer()),
    end = separator(bytes);
  if (end < 0) return null;
  const link = oneClick(new TextDecoder().decode(bytes.subarray(0, end)).trimEnd());
  if (!link) return null;
  try {
    return publicUrl(link.href);
  } catch {
    return null;
  }
}
export async function leaveList(
  env: Bindings,
  user: string,
  box: string,
  id: string,
  confirm: unknown,
) {
  const target = await listTarget(env, user, box, id);
  if (!target || confirm !== target.host) throw new Problem(403, "List action unavailable");
  try {
    await publicFetch(target.href, {
      body: "List-Unsubscribe=One-Click",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      limit: 16384,
    });
  } catch {
    throw new Problem(502, "The publisher did not confirm the request");
  }
  return { accepted: true };
}
