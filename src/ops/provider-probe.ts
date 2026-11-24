import { EmailMessage } from "cloudflare:email";
import { ulid } from "ulid";
import { address } from "../address";
import { type Bindings, type Principal, Problem } from "../env";
import { human } from "./access";

// A fixed operator-owned fixture. Its recipient, sender and run ID are all deployment bindings.
export async function providerProbe(env: Bindings, p: Principal, path: unknown) {
  if (!env.PROBE_MODE || !["capture", "cloudflare"].includes(env.PROBE_MODE))
    throw new Problem(404, "Probe unavailable");
  const user = human(p);
  if (user.role !== "owner") throw new Problem(403, "Instance owner required");
  if (path !== "builder" && path !== "raw") throw new Problem(400, "Select builder or raw");
  const capture = env.PROBE_MODE === "capture";
  if (!capture && (!env.EMAIL || !env.PROBE_RUN || !env.PROBE_FROM || !env.PROBE_TO))
    throw new Problem(503, "Provider probe configuration missing");
  const from = address(env.PROBE_FROM || "support@example.test").canonical;
  const to = address(env.PROBE_TO || "customer@example.test").canonical;
  const id = ulid(),
    run = env.PROBE_RUN || "local",
    provider = env.PROBE_MODE;
  const supplied = path === "raw" ? `<${id}@${from.split("@")[1]}>` : null;
  const claim =
    await env.DB.prepare(`INSERT INTO provider_probes VALUES (?,?,?,?,?,'uncertain',NULL,?)
    ON CONFLICT(run_id,provider,path) DO NOTHING`)
      .bind(run, provider, path, user.id, id, supplied)
      .run();
  if (claim.meta.changes) {
    const providerId = await submitFixture(env, { from, to, id, supplied, path, capture }).catch(
      () => {
        throw new Problem(502, "Check the owned mailbox before starting another provider run");
      },
    );
    await env.DB.prepare("UPDATE provider_probes SET state=?,provider_id=? WHERE submission_id=?")
      .bind(capture ? "captured" : "submitted", providerId, id)
      .run();
  }
  return env.DB.prepare(`SELECT submission_id,state,provider_id,supplied_wire_id FROM provider_probes
    WHERE run_id=? AND provider=? AND path=?`)
    .bind(run, provider, path)
    .first();
}

type Fixture = {
  from: string;
  to: string;
  id: string;
  supplied: string | null;
  path: "builder" | "raw";
  capture: boolean;
};
export async function submitFixture(
  env: Pick<Bindings, "MAIL" | "EMAIL">,
  { from, to, id, supplied, path, capture }: Fixture,
) {
  const subject = "Order delivery confirmation " + id,
    text = "In response to your delivery question, your test order is scheduled for tomorrow.";
  const builder = { from, to, subject, text };
  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${supplied}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text,
    "",
  ].join("\r\n");
  if (capture) {
    await env.MAIL.put(
      "capture/" + id + (path === "raw" ? ".eml" : ".json"),
      path === "raw" ? raw : JSON.stringify(builder),
    );
    return "capture-" + id;
  }
  const email = env.EMAIL;
  if (!email) throw new Problem(503, "Provider unavailable");
  return (
    (await (path === "raw" ? email.send(new EmailMessage(from, to, raw)) : email.send(builder)))
      ?.messageId ?? null
  );
}
