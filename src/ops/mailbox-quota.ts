import * as z from "zod/mini";
import { Problem, type Bindings } from "../env";
import { inventoryPage, bytesPerMessage } from "../inbound-capacity";
import { owner } from "./destinations";
import type { User } from "./access";
const limit = z.nullable(z.number().check(z.int(), z.minimum(1), z.maximum(10_000_000_000_000)));
const schema = z.object({
  r2_soft: limit,
  r2_hard: limit,
  d1_soft: limit,
  d1_hard: limit,
  sender_rate: limit,
  recipient_rate: limit,
});
export async function mailboxQuota(
  env: Bindings,
  user: User,
  box: string,
  data?: Record<string, unknown>,
) {
  await owner(env, user, box);
  if (data) {
    if (user.role !== "owner") throw new Problem(403, "Instance owner required");
    const parsed = schema.safeParse(data);
    if (!parsed.success)
      throw new Problem(400, "Enter positive whole-number limits or leave them empty");
    const p = parsed.data;
    if (
      (p.r2_soft && p.r2_hard && p.r2_soft > p.r2_hard) ||
      (p.d1_soft && p.d1_hard && p.d1_soft > p.d1_hard)
    )
      throw new Problem(400, "Soft limits must be at or below hard limits");
    if (Object.values(p).every((v) => v === null))
      await env.DB.prepare("DELETE FROM mailbox_quotas WHERE mailbox_id=?").bind(box).run();
    else {
      await env.DB.prepare(
        "INSERT INTO mailbox_quotas VALUES(?,?,?,?,?,?,?) ON CONFLICT(mailbox_id) DO UPDATE SET r2_soft=excluded.r2_soft,r2_hard=excluded.r2_hard,d1_soft=excluded.d1_soft,d1_hard=excluded.d1_hard,sender_rate=excluded.sender_rate,recipient_rate=excluded.recipient_rate",
      )
        .bind(box, p.r2_soft, p.r2_hard, p.d1_soft, p.d1_hard, p.sender_rate, p.recipient_rate)
        .run();
      for (let i = 0; i < 6; i++) if (!(await inventoryPage(env, box))) break;
    }
  }
  return (
    (await env.DB.prepare(
      "SELECT q.*,total AS r2_bytes,measured,messages*? AS estimated_d1_bytes FROM mailbox_quotas q JOIN quota_usage u ON u.box=q.mailbox_id WHERE mailbox_id=?",
    )
      .bind(bytesPerMessage, box)
      .first()) || null
  );
}
