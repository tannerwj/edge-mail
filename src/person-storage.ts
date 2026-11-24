import type { Bindings } from "./env";
export type ErasureStore = Pick<Bindings, "DB" | "MAIL">;
export type PersonRecord = { target: string; actor: string; at: number; boxes: string };
export const personKey = (target: string) => "person-erasures/v1/" + target + ".json";
const identifier = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export function verifyPerson(record: PersonRecord, key: string) {
  const boxes: unknown = JSON.parse(record.boxes);
  if (
    !identifier.test(record.target) ||
    !identifier.test(record.actor) ||
    record.actor === record.target ||
    key !== personKey(record.target) ||
    !Number.isSafeInteger(record.at) ||
    !Array.isArray(boxes) ||
    boxes.some((b) => typeof b !== "string" || !identifier.test(b))
  )
    throw Error("Invalid person erasure record");
  return record;
}
export async function recordPerson(env: ErasureStore, r: PersonRecord) {
  const item = { target: r.target, actor: r.actor, at: r.at, boxes: r.boxes },
    key = personKey(r.target);
  verifyPerson(item, key);
  await env.MAIL.put(key, JSON.stringify(item), { onlyIf: { etagDoesNotMatch: "*" } });
  const stored = await env.MAIL.get(key);
  if (!stored) throw Error("Person erasure record missing");
  const verified = verifyPerson(await stored.json<PersonRecord>(), key);
  if (verified.boxes !== r.boxes || verified.at !== r.at || verified.actor !== r.actor)
    throw Error("Conflicting person erasure request");
  await env.DB.prepare("UPDATE person_erasures SET journaled=1 WHERE target=?")
    .bind(r.target)
    .run();
}
export async function cleanupPersonObjects(env: ErasureStore, target: string) {
  const now = Date.now(),
    rows = await env.DB.prepare(
      "SELECT path,prefix,cursor FROM person_cleanup WHERE target=? AND due<=? ORDER BY due,path LIMIT 4",
    )
      .bind(target, now)
      .all<{ path: string; prefix: number; cursor: string | null }>();
  for (const work of rows.results) {
    if (!work.prefix) {
      await env.MAIL.delete(work.path);
      await env.DB.prepare("DELETE FROM person_cleanup WHERE path=?").bind(work.path).run();
      continue;
    }
    const list = await env.MAIL.list({
      prefix: work.path,
      cursor: work.cursor || undefined,
      limit: 32,
    });
    const keys = list.objects.map((o) => o.key);
    if (keys.length) {
      try {
        await env.MAIL.delete(keys);
      } catch (error) {
        if (
          !/^(?:raw|sent)\//.test(work.path) ||
          !(error instanceof Error) ||
          !/retention|lock|protected/i.test(error.message)
        )
          throw error;
        const due = Math.max(
          now + 3600000,
          ...list.objects.map((o) => o.uploaded.getTime() + 35 * 86400000),
        );
        await env.DB.prepare("UPDATE person_cleanup SET due=? WHERE path=?")
          .bind(due, work.path)
          .run();
        continue;
      }
    }
    if (list.truncated)
      await env.DB.prepare("UPDATE person_cleanup SET cursor=? WHERE path=? AND cursor IS ?")
        .bind(list.cursor, work.path, work.cursor)
        .run();
    else await env.DB.prepare("DELETE FROM person_cleanup WHERE path=?").bind(work.path).run();
  }
}

export async function erasedMailboxReceipt(env: ErasureStore, box: string) {
  const result = await env.DB.prepare("SELECT target FROM person_boxes WHERE box=?")
    .bind(box)
    .first<string>("target");
  if (!result) return false;
  // Reconciliation can encounter raw mail accepted just before the mailbox closed.
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO person_cleanup(target,path,prefix) VALUES(?,?,1)").bind(
      result,
      "raw/" + box + "/",
    ),
    env.DB.prepare("UPDATE person_erasures SET finished=0 WHERE target=? AND finished=1").bind(
      result,
    ),
  ]);
  return true;
}
