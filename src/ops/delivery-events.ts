import { mappings } from "./identities";
import * as z from "zod/mini";
import type { Bindings } from "../env";
import { changed } from "../live";

const envelope = z.object({
  type: z.string(),
  source: z.object({ type: z.literal("email.sending"), domain: z.string() }),
  payload: z.object({
    eventId: z.string(),
    messageId: z.string(),
    sender: z.string(),
    recipient: z.string(),
    delivery: z.optional(z.object({ smtpStatusCode: z.optional(z.string()) })),
  }),
  metadata: z.object({ eventTimestamp: z.string() }),
});
const kinds = new Set(["delivered", "deferred", "bounced", "failed", "rejected", "complained"]);
export async function recordEvent(env: Bindings, data: unknown) {
  const parsed = envelope.safeParse(data);
  if (!parsed.success) return;
  const { payload, source, metadata, type } = parsed.data;
  const sender = payload.sender.toLowerCase(),
    domain = source.domain.toLowerCase();
  if (
    !(
      sender === (env.EVENT_SENDER ?? env.SEND_FROM)?.toLowerCase() ||
      mappings(env).some((m) => m.from === sender)
    ) ||
    sender.split("@")[1] !== domain
  )
    return;
  const kind = type.slice("cf.email.sending.message.".length);
  const at = Date.parse(metadata.eventTimestamp);
  const id = payload.messageId.replace(/^<|>$/g, "");
  if (
    !type.startsWith("cf.email.sending.message.") ||
    !kinds.has(kind) ||
    !Number.isFinite(at) ||
    !id ||
    id.length > 998 ||
    !payload.eventId ||
    payload.eventId.length > 128 ||
    payload.recipient.length > 320
  )
    return;
  await env.DB.prepare(
    "INSERT INTO delivery_events VALUES(?,'cloudflare',?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING",
  )
    .bind(
      payload.eventId,
      domain,
      id,
      payload.recipient.toLowerCase(),
      kind,
      new Date(at).toISOString(),
      payload.delivery?.smtpStatusCode?.slice(0, 3) || null,
    )
    .run();
  const item = await env.DB.prepare(
    "SELECT mailbox_id FROM outbox WHERE provider='cloudflare' AND from_addr=? AND (provider_id=? OR provider_id=?) LIMIT 1",
  )
    .bind(sender, id, "<" + id + ">")
    .first<{ mailbox_id: string }>();
  if (item) await changed(env, item.mailbox_id);
}
export async function deliveryEvents(env: Bindings, batch: MessageBatch) {
  for (const item of batch.messages) {
    try {
      await recordEvent(env, item.body);
      item.ack();
    } catch {
      item.retry();
    }
  }
}
