// The local Email Routing emulator does not deliver relay mail to an external recipient.
import { relayRules } from "../src/ops/forward";
import type { Bindings } from "../src/env";
import * as z from "zod/mini";
const fixture = z.object({
  box: z.string(),
  id: z.string(),
  capture: z.optional(z.boolean()),
  loop: z.optional(z.boolean()),
  fail: z.optional(z.boolean()),
});
export async function relayBoundary(env: Bindings, request: Request) {
  const f = fixture.parse(await request.json());
  const to = "support@mail.test",
    from = "receipts@shop.test";
  const h = new Headers({ from, to, subject: "Order relay", "message-id": f.id });
  if (f.loop) h.set("X-Edge-Mail-Loop", "returned");
  const calls: { recipient: string; marker: string | null }[] = [];
  const message = {
    headers: h,
    rawSize: 200,
    canBeForwarded: true,
    async forward(recipient: string, headers?: Headers) {
      calls.push({ recipient, marker: headers?.get("X-Edge-Mail-Loop") || null });
      if (f.fail) throw Error("Acknowledgement interrupted");
      return { messageId: f.id };
    },
  };
  try {
    await relayRules(
      { ...env, SEND_MODE: f.capture ? "capture" : undefined, PROBE_MODE: undefined },
      message,
      {
        id: "receipt",
        mailbox: f.box,
        from,
        to,
        matched: to,
        kind: "primary",
        tag: null,
        at: new Date().toISOString(),
        auth: { dmarc: "pass" },
      },
    );
  } catch (error) {
    if (!f.fail) throw error;
  }
  return Response.json({ calls });
}
