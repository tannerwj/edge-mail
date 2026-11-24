import { createHmac } from "node:crypto";
import * as z from "zod/mini";
import { type Bindings, Problem } from "./env";
import { reportFormat, replyFormat } from "./feedback-format";

const intake = "https://edge-mail-feedback.tannerwj.dev/v1/report";
const command = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("send"), id: z.uuid(), report: reportFormat }),
  z.strictObject({ action: z.literal("status"), id: z.uuid() }),
]);

export async function projectFeedback(env: Bindings, person: string, data: unknown) {
  if (env.PROJECT_FEEDBACK === "off")
    throw new Problem(403, "Private project feedback is disabled for this installation.");
  const parsed = command.safeParse(data);
  if (!parsed.success)
    throw new Problem(400, "Invalid feedback request. Check the category and summary.");
  const item = parsed.data;
  const receipt = createHmac("sha256", env.SETUP_TOKEN)
    .update(JSON.stringify(["edge-mail-project-feedback-v1", person, item.id]))
    .digest("base64url");
  const res = await fetch(intake, {
    method: item.action === "send" ? "PUT" : "GET",
    headers: { Authorization: "Bearer " + receipt, "Content-Type": "application/json" },
    body: item.action === "send" ? JSON.stringify(item.report) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  }).catch(() => {
    throw new Problem(503, "The feedback inbox is unavailable. Try again later.");
  });
  if (res.status === 429) throw new Problem(429, "The feedback inbox is busy. Try again later.");
  if (res.status === 404)
    throw new Problem(404, "The maintainer inbox has no report for this receipt.");
  if (res.status === 409) throw new Problem(409, "This receipt already belongs to another report.");
  if (!res.ok) throw new Problem(502, "The feedback inbox could not complete the request.");
  const body: unknown = await res.json();
  if (item.action === "send") return z.object({ received: z.literal(true) }).parse(body);
  return replyFormat.parse(body);
}
