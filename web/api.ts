import * as z from "zod/mini";
export async function api(path: string, data?: object): Promise<unknown> {
  const res = await fetch("/api/" + path, {
    redirect: "manual",
    ...(data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {}),
  });
  if (res.type === "opaqueredirect") {
    location.reload();
    throw new Error("Sign-in expired");
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Request failed");
  return body;
}
export const sessionSchema = z.object({
  email: z.string(),
  role: z.nullable(z.string()),
  setup: z.boolean(),
});
const box = z.object({
  id: z.string(),
  address: z.string(),
  display_name: z.string(),
  domain_id: z.string(),
  unread: z.optional(z.number()),
  can_edit: z.optional(z.number()),
  can_forward: z.optional(z.number()),
  capture: z.optional(z.boolean()),
  send_from: z.optional(z.nullable(z.string())),
});
export const spaceSchema = z.object({
  mailboxes: z.array(box),
  managed: z.array(box),
  domains: z.array(z.object({ id: z.string(), name: z.string() })),
  user: z.object({ role: z.string() }),
});
const message = {
  id: z.string(),
  sender: z.string(),
  subject: z.string(),
  received_at: z.string(),
  attachment_count: z.number(),
  is_read: z.number(),
  starred: z.number(),
  folder: z.string(),
};
export const inboxSchema = z.object({
  messages: z.array(
    z.object({
      ...message,
      mailbox_id: z.optional(z.string()),
      snippet: z.string(),
      message_count: z.number(),
    }),
  ),
  next: z.nullable(z.string()),
});
export const detailSchema = z.object({
  ...message,
  thread: z.optional(
    z.nullable(
      z.object({
        thread_id: z.string(),
        muted: z.nullable(z.number()),
        snoozed_until: z.nullable(z.number()),
        follow_up_at: z.nullable(z.number()),
        if_no_reply: z.nullable(z.number()),
        follow_ready: z.nullable(z.number()),
      }),
    ),
  ),
  body: z.string(),
  formatted: z.boolean(),
  protection: z.optional(z.enum(["none", "encrypted", "signed"])),
  unsubscribeHost: z.optional(z.nullable(z.string())),
  deliveryStatus: z.array(z.object({ kind: z.string(), recipients: z.number() })),
  labels: z.array(z.string()),
  conversation: z.array(
    z.object({ id: z.string(), subject: z.string(), received_at: z.string(), sender: z.string() }),
  ),
  screening: z.optional(z.nullable(z.string())),
  deliveries: z.array(
    z.object({
      id: z.string(),
      envelope_to: z.string(),
      kind: z.string(),
      received_at: z.string(),
      auth: z.string(),
    }),
  ),
});
export type Session = z.infer<typeof sessionSchema>;
export type Workspace = z.infer<typeof spaceSchema>;
export type Box = z.infer<typeof box>;
