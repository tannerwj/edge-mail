import { syntheticAssistant } from "./synthetic-assistant";
import { wakeThreads } from "../src/ops/thread-state";
import { relayBoundary } from "./relay-boundary";
export { MailboxLive } from "../src/live";
export { OutboxClock } from "../src/outbox-clock";
// Test entry point only. The real email handler persists bytes, then its queue binding fails.
import worker from "../src/worker";
import { receive } from "../src/ops/receipt";
import { ingest, receiptJob } from "../src/ops/ingest";
import { workspace } from "../src/ops/mailboxes";
import { snapshot, beginSnapshot } from "../src/snapshot";
import { recordEvent } from "../src/ops/delivery-events";
import { Problem, type Bindings } from "../src/env";
export default {
  ...worker,
  async email(message: ForwardableEmailMessage, env: Bindings) {
    return receive(message, {
      ...env,
      INGEST: {
        send: async () => {
          throw new Error("Queue unavailable");
        },
      },
    });
  },
  async fetch(req: Request, env: Bindings) {
    const location = new URL(req.url);
    if (location.pathname === "/test/relay" && req.method === "POST")
      return relayBoundary(env, req);
    if (location.pathname === "/test/delivery-event" && req.method === "POST") {
      await recordEvent({ ...env, EVENT_SENDER: "support@mail.test" }, await req.json());
      return Response.json({ ok: true });
    }
    if (location.pathname === "/test/wake") {
      await wakeThreads(env);
      return Response.json({ ok: true });
    }
    if (location.pathname === "/test/snapshot-start") {
      await beginSnapshot(env);
      return Response.json({ ok: true });
    }
    if (location.pathname === "/test/snapshot-finish") {
      await snapshot(env);
      return Response.json({ ok: true });
    }
    if (location.pathname === "/test/snapshot-part") {
      const name = location.searchParams.get("key") || "";
      if (!name.startsWith("snapshots/")) return new Response(null, { status: 404 });
      const part = await env.MAIL.get(name);
      return new Response(part?.body, { status: part ? 200 : 404 });
    }
    if (new URL(req.url).pathname === "/test/jobs") {
      const list = await env.MAIL.list({ prefix: "raw/" });
      const key = list.objects[0].key;
      const job = receiptJob(key);
      const denied = await Promise.all(
        [
          ingest(env, { ...job, mailbox: "another" }, key),
          workspace(env, job),
          ingest(env, { kind: "user", id: "fixture", role: "owner" }, key),
        ].map((op) =>
          op.then(
            () => 0,
            (error) => (error instanceof Problem ? error.status : 500),
          ),
        ),
      );
      return Response.json(denied);
    }
    if (new URL(req.url).pathname === "/test/replay") {
      const list = await env.MAIL.list({ prefix: "raw/" });
      for (const obj of list.objects) await ingest(env, receiptJob(obj.key), obj.key);
      return Response.json({ replayed: list.objects.length });
    }
    return worker.fetch(req, { ...env, AI: syntheticAssistant });
  },
};
