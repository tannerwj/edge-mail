import type { User } from "./ops/access";

export interface Bindings extends WorkerBindings {
  AI?: {
    run(
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      input: {
        messages: { role: "system" | "user"; content: string }[];
        max_tokens: number;
        temperature: number;
      },
    ): Promise<unknown>;
  };
  MAIL_ACCOUNT_ID?: string;
  ACCOUNT_ANALYTICS_TOKEN?: string;
  SUPPRESSION_API_TOKEN?: string;
  ROUTING_ADDRESS_TOKEN?: string;
  INGEST: Queue<string>;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_IDENTITY?: string;
  CONTENT_ORIGIN?: string;
  EVENT_QUEUE?: string;
  EVENT_SENDER?: string;
  PROJECT_FEEDBACK?: string;
  PROBE_MODE?: string;
  PROBE_RUN?: string;
  PROBE_FROM?: string;
  PROBE_TO?: string;
  EMAIL?: SendEmail;
  OUTBOUND?: SendEmail;
  SEND_MODE?: string;
  SEND_IDENTITIES?: string;
  SEND_FROM?: string;
  SEND_MAILBOX?: string;
  LIVE: DurableObjectNamespace<import("./live").MailboxLive>;
  OUTBOX_CLOCK: DurableObjectNamespace<import("./outbox-clock").OutboxClock>;
}
export type Identity = { email: string; expires: number };
export type Ingest = { kind: "ingest"; mailbox: string };
export type Principal = User | Ingest;
export class Problem extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireValue(value: unknown, max = 254) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new Problem(400, "Invalid field");
  return value.trim();
}
