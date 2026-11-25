import * as z from "zod/mini";

export const kinds = ["bug", "confusing", "missing", "slow", "idea", "question"] as const;
export const areas = [
  "",
  "Inbox",
  "Compose",
  "Reader",
  "Search",
  "Settings",
  "Installation",
  "Integrations",
] as const;
export const reportFormat = z.strictObject({
  kind: z.enum(kinds),
  summary: z.string().check(z.trim(), z.minLength(1), z.maxLength(200)),
  details: z.optional(z.string().check(z.trim(), z.maxLength(2000))),
  tool_name: z.enum(areas),
  server_version: z.string().check(z.regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/)),
});
export const replyFormat = z.object({
  status: z.enum(["new", "acknowledged", "planned", "done", "declined"]),
  reply: z.string().check(z.maxLength(1000)),
  issue: z.string().check(z.regex(/^(?:https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)?$/)),
});
