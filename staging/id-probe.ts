import { submitFixture } from "../src/ops/provider-probe";
type Env = { MAIL: R2Bucket; EMAIL: SendEmail; FROM: string; TO: string; RUN: string };
export default {
  fetch() {
    return new Response(null, { status: 403 });
  },
  async scheduled(_event: ScheduledController, env: Env) {
    for (const path of ["builder", "raw"] as const) {
      const key = "probe-results/" + env.RUN + "/" + path + ".json";
      const id = env.RUN + "-" + path;
      const supplied = path === "raw" ? "<" + id + "@" + env.FROM.split("@")[1] + ">" : null;
      const claim = { id, path, supplied, state: "uncertain", providerId: null };
      if (!(await env.MAIL.put(key, JSON.stringify(claim), { onlyIf: { etagDoesNotMatch: "*" } })))
        continue;
      // A failed or interrupted submission remains uncertain and is never retried.
      try {
        const providerId = await submitFixture(env, {
          from: env.FROM,
          to: env.TO,
          id,
          supplied,
          path,
          capture: false,
        });
        await env.MAIL.put(key, JSON.stringify({ ...claim, state: "submitted", providerId }));
      } catch (error) {
        const cause = error instanceof Error ? error.message : "";
        const code =
          /\bE_[A-Z_]+\b/.exec(cause)?.[0] ||
          (/not verified/i.test(cause) ? "recipient_unverified" : "unknown");
        await env.MAIL.put(key, JSON.stringify({ ...claim, errorCode: code }));
        console.error(JSON.stringify({ event: "provider_probe_uncertain", path }));
      }
    }
  },
};
