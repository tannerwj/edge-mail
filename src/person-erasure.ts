import * as z from "zod/mini";
import { Problem, type Bindings } from "./env";
import { type User } from "./ops/access";
import {
  cleanupPersonObjects,
  recordPerson,
  type PersonRecord,
  type ErasureStore,
} from "./person-storage";
import { preparePerson, purgeOneBox } from "./person-purge";
const identifier = z.string().check(z.regex(/^[0-9A-HJKMNP-TV-Z]{26}$/));
type Work = PersonRecord & { journaled: number; prepared: number; finished: number };
const privateBoxes =
  "SELECT m.mailbox_id FROM mailbox_members m WHERE m.user_id=t.id AND m.role='owner' AND NOT EXISTS(SELECT 1 FROM mailbox_members o WHERE o.mailbox_id=m.mailbox_id AND o.user_id!=t.id) ORDER BY m.mailbox_id";
const plan =
  "SELECT t.id target,a.id actor,(SELECT json_group_array(mailbox_id) FROM (" +
  privateBoxes +
  ")) boxes FROM users t JOIN users a ON a.id=? AND a.role='owner' AND a.disabled_at IS NULL WHERE t.id=? AND t.id!=a.id";
async function receipt(env: ErasureStore, target: string) {
  const row = await env.DB.prepare(
    "SELECT target,at,journaled,prepared,finished,(SELECT count(*) FROM person_boxes b WHERE b.target=p.target AND closed=0) remaining_mailboxes,(SELECT count(*) FROM person_cleanup k WHERE k.target=p.target) pending_storage FROM person_erasures p WHERE target=?",
  )
    .bind(target)
    .first();
  if (!row) throw new Problem(404, "Erasure receipt unavailable");
  return row;
}
export async function advancePerson(env: ErasureStore, work: Work) {
  if (!work.journaled) await recordPerson(env, work);
  if (!work.prepared) await preparePerson(env, work);
  if (await purgeOneBox(env, work.target)) return;
  await cleanupPersonObjects(env, work.target);
  await env.DB.prepare(
    "UPDATE person_erasures SET finished=1 WHERE target=? AND NOT EXISTS(SELECT 1 FROM person_cleanup WHERE target=?)",
  )
    .bind(work.target, work.target)
    .run();
}
export async function sweepPeople(env: ErasureStore) {
  const work = await env.DB.prepare(
    "SELECT * FROM person_erasures p WHERE finished=0 AND (prepared=0 OR EXISTS(SELECT 1 FROM person_boxes b WHERE b.target=p.target AND closed=0) OR NOT EXISTS(SELECT 1 FROM person_cleanup k WHERE k.target=p.target) OR EXISTS(SELECT 1 FROM person_cleanup k WHERE k.target=p.target AND k.due<=?)) ORDER BY at LIMIT 1",
  )
    .bind(Date.now())
    .first<Work>();
  if (!work) return false;
  await advancePerson(env, work);
  return true;
}
export async function personErasure(env: Bindings, user: User, data?: Record<string, unknown>) {
  if (user.role !== "owner") throw new Problem(403, "Instance owner required");
  if (!data)
    return (
      await env.DB.prepare(
        "SELECT target,at,finished FROM person_erasures ORDER BY at DESC LIMIT 50",
      ).all()
    ).results;
  const parsed = identifier.safeParse(data.target);
  if (!parsed.success) throw new Problem(400, "Choose a valid person");
  const target = parsed.data;
  if (data.action === "receipt") return receipt(env, target);
  const proposed = await env.DB.prepare(plan)
    .bind(user.id, target)
    .first<{ target: string; actor: string; boxes: string }>();
  if (!proposed) throw new Problem(400, "Choose another person");
  if (data.action === "preview")
    return {
      target,
      boxes: JSON.parse(proposed.boxes),
      drafts: await env.DB.prepare("SELECT count(*) FROM drafts WHERE actor=?")
        .bind(target)
        .first<number>("count(*)"),
    };
  if (data.action !== "erase" || data.confirm !== target || !Array.isArray(data.boxes))
    throw new Problem(400, "Confirm the person and mailbox selection");
  const chosen = JSON.stringify(data.boxes);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO person_erasures(target,actor,boxes,at) SELECT target,actor,boxes,? FROM (" +
      plan +
      ") WHERE boxes=?",
  )
    .bind(Date.now(), user.id, target, chosen)
    .run();
  const work = await env.DB.prepare("SELECT * FROM person_erasures WHERE target=?")
    .bind(target)
    .first<Work>();
  if (!work) throw new Problem(409, "Mailbox ownership changed. Review the erasure again.");
  if (!work.finished) await advancePerson(env, work);
  return receipt(env, target);
}
