import { relayScreen } from "./screening";
import { attempt, instanceId, blocked, type Claims } from "./forward-claim";
import { ulid } from "ulid";
import { addressParser } from "postal-mime";
import { type Bindings } from "../env";
import { compileCondition, type Facts } from "../rule-matcher";
import { effective, definition, type Rule } from "./rule-definitions";

import type { Receipt } from "./receipt";

export type ForwardAction = {
  kind: "forward";
  mode: "relay" | "resend";
  destination: string;
  reply_through?: boolean;
};
const bodyFields = new Set(["body", "has_attachment", "attachment_type"]);
export function headersOnly(condition: unknown): boolean {
  if (!condition || typeof condition !== "object") return false;
  if ("field" in condition && typeof condition.field === "string")
    return !bodyFields.has(condition.field);
  return Object.values(condition).flat().every(headersOnly);
}
function headerFacts(message: RelayMessage, meta: Receipt): Facts {
  const h = message.headers;
  const addresses = (key: string) =>
    addressParser(h.get(key) || "", { flatten: true }).map((a) => a.address || "");
  const from = addresses("from")[0] || meta.from;
  const f: Facts = {
    from: [from],
    sender_domain: [from.split("@").at(-1) || ""],
    to: addresses("to"),
    cc: addresses("cc"),
    subject: [h.get("subject") || ""],
    direction: ["inbound"],
    size: [String(message.rawSize)],
    delivered_to: [meta.to],
    alias: [meta.matched],
    plus_tag: [meta.tag || ""],
    list_id: h.has("list-id") ? [h.get("list-id") || ""] : [],
    spf: [meta.auth.spf || ""],
    dkim: [meta.auth.dkim || ""],
    dmarc: [meta.auth.dmarc || ""],
  };
  for (const [key, value] of h) {
    f["header:" + key] = [value.slice(0, 4096)];
  }
  return f;
}
type RelayMessage = Pick<
  ForwardableEmailMessage,
  "headers" | "canBeForwarded" | "rawSize" | "forward"
>;
type ForwardEnv = Pick<
  Bindings,
  "DB" | "CONTENT_ORIGIN" | "ACCESS_AUD" | "SEND_MODE" | "PROBE_MODE"
>;
async function relay(
  env: ForwardEnv,
  v: Rule,
  a: ForwardAction,
  claims: Claims,
  message: RelayMessage,
) {
  const id = ulid();
  const row = await attempt(env, v, a.destination, claims, id, null).first<{ address: string }>();
  if (!row || claims.reason) return;
  let state = "uncertain";
  try {
    if (env.SEND_MODE === "capture" || env.PROBE_MODE === "capture") state = "captured";
    else {
      await message.forward(row.address, new Headers({ "X-Edge-Mail-Loop": instanceId(env) }));
      state = "submitted";
    }
  } finally {
    await env.DB.prepare("UPDATE forward_attempts SET state=? WHERE id=? AND state='claimed'")
      .bind(state, id)
      .run();
  }
}
export async function relayRules(env: ForwardEnv, message: RelayMessage, meta: Receipt) {
  const rows = await env.DB.prepare(effective).bind(meta.mailbox).all<Rule>();
  if (!rows.results.some((v) => v.document.includes('"forward"'))) return;
  const f = headerFacts(message, meta),
    source = message.headers.get("message-id")?.trim() || "";
  const reason =
    blocked(f) ||
    (await relayScreen(env, meta.mailbox, f)) ||
    (!/^<[^<>\s]{1,990}>$/.test(source)
      ? "missing_message_id"
      : !message.canBeForwarded
        ? "cannot_forward"
        : null);
  const claims = {
    box: meta.mailbox,
    source: source || meta.id,
    sender: meta.from.trim().toLowerCase(),
    mode: "relay",
    reason,
  };
  for (const v of rows.results) {
    const doc = definition(JSON.parse(v.document));
    if (!headersOnly(doc.condition)) {
      if (doc.stop) break;
      continue;
    }
    if (!compileCondition(doc.condition)(f)) continue;
    for (const a of doc.actions)
      if (a.kind === "forward" && a.mode === "relay") await relay(env, v, a, claims, message);
    if (doc.stop) break;
  }
}
