import { sweepDiscardedDrafts } from "./ops/compose-undo";
import { sweepCapacity } from "./inbound-capacity";
import { sweepPeople } from "./person-erasure";
import { checkOperatingAlerts } from "./ops/budgets";
import { wakeThreads } from "./ops/thread-state";
import { flushHooks } from "./ops/webhooks";
import { sweepErasures } from "./ops/erasure";
import { flushPush } from "./ops/push";
import { sweepUploads } from "./agents/uploads";
import { expireChanges } from "./agents/changes";
import { sweepOAuth } from "./oauth/protocol";
import { sweepOffboarding } from "./ops/offboard";
export { MailboxLive } from "./live";
import { deliveryEvents } from "./ops/delivery-events";
import { type Bindings } from "./env";
import { http } from "./http";
import { receive } from "./ops/receipt";
import { consume, reconcile } from "./ops/ingest";

export { OutboxClock } from "./outbox-clock";
import { snapshot } from "./snapshot";
import { sweepOutbox } from "./ops/dispatch";
export default {
  fetch(request, env, ctx?: ExecutionContext) {
    return http(request, env, undefined, ctx);
  },
  email: receive,
  async queue(batch, env) {
    if (batch.queue === (env.EVENT_QUEUE ?? "edge-mail-events")) return deliveryEvents(env, batch);
    return consume(batch, env);
  },
  async scheduled(_event, env) {
    await Promise.all([
      sweepCapacity(env),
      reconcile(env),
      sweepOutbox(env),
      sweepDiscardedDrafts(env),
      snapshot(env),
      sweepOffboarding(env),
      sweepPeople(env),
      sweepOAuth(env),
      expireChanges(env),
      sweepErasures(env),
      sweepUploads(env),
      Promise.all([wakeThreads(env), checkOperatingAlerts(env)]).then(() => flushPush(env)),
      flushHooks(env),
    ]);
  },
} satisfies ExportedHandler<Bindings>;
