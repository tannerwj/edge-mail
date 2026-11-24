import { receive } from "../src/ops/receipt";
import type { Bindings } from "../src/env";
type Env = Bindings & { SPIKE_RUN: string; SPIKE_FROM: string };
export default {
  fetch() {
    return new Response(null, { status: 403 });
  },
  async email(mail: ForwardableEmailMessage, env: Env) {
    const local = mail.to.toLowerCase().split("@")[0],
      prefix = "em-" + env.SPIKE_RUN + "-";
    if (mail.from.toLowerCase() !== env.SPIKE_FROM || !local.startsWith(prefix))
      return mail.setReject("Unrecognized probe");
    const id = mail.headers.get("message-id");
    const scenario = ["slow", "fault", "limit", "over"].find(
      (kind) => id === "<" + env.SPIKE_RUN + "-" + kind + "@" + env.SPIKE_FROM.split("@")[1] + ">",
    );
    const kind = scenario || local.slice(prefix.length),
      start = Date.now();
    try {
      if (kind === "fault") throw Error("Synthetic failure before durable receipt");
      if (kind === "slow") await new Promise((resolve) => setTimeout(resolve, 8500));
      await receive(mail, env);
    } finally {
      await env.MAIL.put(
        "probe-observations/" + env.SPIKE_RUN + "/" + crypto.randomUUID() + ".json",
        JSON.stringify({
          kind,
          bytes: mail.rawSize,
          elapsed_ms: Date.now() - start,
          at: new Date(start).toISOString(),
        }),
      );
    }
  },
};
