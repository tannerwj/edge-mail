import { reserveReceipt } from "../inbound-capacity";
import { relayRules } from "./forward";
import { ulid } from "ulid";
import { resolveRecipient } from "./recipient-routing";
import { type Bindings, Problem } from "../env";
import { inspectWire } from "../wire";

export const MAX_RAW = 25 * 1024 * 1024;
export type Receipt = {
  id: string;
  mailbox: string;
  from: string;
  to: string;
  matched: string;
  kind: string;
  tag: string | null;
  at: string;
  auth: Record<string, string>;
};
type ReceiptBindings = Pick<
  Bindings,
  "DB" | "MAIL" | "CONTENT_ORIGIN" | "ACCESS_AUD" | "SEND_MODE" | "PROBE_MODE"
> & {
  INGEST: Pick<Queue<string>, "send">;
};
export async function receive(message: ForwardableEmailMessage, env: ReceiptBindings) {
  if (message.rawSize > MAX_RAW) {
    message.setReject("Message exceeds size limit");
    return;
  }
  const route = await resolveRecipient(env, message.to).catch((error) => {
    if (error instanceof Problem && error.status === 400) return null;
    throw error;
  });
  if (route === "drop") return;
  if (!route) {
    message.setReject("Address does not exist");
    return;
  }
  const at = new Date().toISOString(),
    id = ulid();
  const key = `raw/${route.mailbox_id}/${at.slice(0, 4)}/${at.slice(5, 7)}/${id}.eml`;
  if (
    !(await reserveReceipt(env, route.mailbox_id, {
      id,
      key,
      size: message.rawSize,
      from: message.from,
      to: message.to,
    }))
  ) {
    message.setReject("Mailbox storage or inbound rate limit reached");
    return;
  }
  const wire = await inspectWire(message.raw, message.rawSize);
  const receipt: Receipt = {
    id,
    mailbox: route.mailbox_id,
    from: message.from,
    to: message.to,
    matched: route.address,
    kind: route.kind,
    tag: route.tag,
    at,
    auth: wire.auth,
  };
  try {
    await Promise.all([
      wire.pumping,
      env.MAIL.put(key, wire.body, {
        customMetadata: { receipt: JSON.stringify(receipt) },
        httpMetadata: { contentType: "message/rfc822" },
      }),
    ]);
  } catch (error) {
    await env.DB.prepare("DELETE FROM quota_reservations WHERE id=?")
      .bind(id)
      .run()
      .catch(() => {});
    throw error;
  }
  try {
    if (route.kind !== "reply-through") await relayRules(env, message, receipt);
  } catch {
    console.error(JSON.stringify({ event: "relay_incomplete", id }));
  }
  try {
    await env.INGEST.send(key);
  } catch {
    console.error(JSON.stringify({ event: "receipt_awaiting_reconciliation", id }));
  }
}
