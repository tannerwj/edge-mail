import { wakeThreads } from "./ops/thread-state";
import { flushPush } from "./ops/push";
import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "./env";
import { dispatch } from "./ops/dispatch";
export class OutboxClock extends DurableObject<Bindings> {
  async schedule(id: string, due: number) {
    await this.ctx.storage.put("item", id);
    await this.ctx.storage.setAlarm(due);
  }
  async remind(due: number) {
    await this.ctx.storage.transaction(async (tx) => {
      const pending = await tx.getAlarm();
      if (pending === null || due < pending) {
        await tx.put("reminder", true);
        await tx.setAlarm(due);
      }
    });
  }
  async alarm() {
    if (await this.ctx.storage.get<boolean>("reminder")) {
      await wakeThreads(this.env);
      await flushPush(this.env);
      const next = await this.env.DB.prepare(
        "SELECT min(due) FROM (SELECT min(snoozed_until) due FROM thread_state UNION ALL SELECT min(follow_up_at) FROM thread_state WHERE follow_ready=0)",
      ).first<number>("min(due)");
      if (next !== null) await this.remind(Math.max(Date.now() + 100, next));
      return;
    }
    const id = await this.ctx.storage.get<string>("item");
    if (id) await dispatch(this.env, id);
  }
}
