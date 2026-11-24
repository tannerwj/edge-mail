import { sweepPeople } from "../src/person-erasure";
import { verifyPerson, type PersonRecord } from "../src/person-storage";
type Env = { DB: D1Database; SOURCE: R2Bucket; TARGET: R2Bucket };
const missingUploads =
  "CREATE TABLE IF NOT EXISTS restore_missing_uploads(box TEXT,draft TEXT,PRIMARY KEY(box,draft))";
export async function missingPrivateUpload(db: D1Database, key: string) {
  const match =
    /^att\/uploads\/([0-9A-HJKMNP-TV-Z]{26})\/([0-9A-HJKMNP-TV-Z]{26})\/[a-f0-9]{64}$/.exec(key);
  if (!match) return false;
  await db.prepare(missingUploads).run();
  await db
    .prepare("INSERT OR IGNORE INTO restore_missing_uploads VALUES(?,?)")
    .bind(match[1], match[2])
    .run();
  return true;
}
export async function restorePeople(env: Env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS restore_people(id INTEGER PRIMARY KEY,cursor TEXT,done INTEGER NOT NULL)",
  ).run();
  await env.DB.prepare(missingUploads).run();
  const state = await env.DB.prepare("SELECT cursor,done FROM restore_people WHERE id=1").first<{
    cursor: string | null;
    done: number;
  }>();
  if (!state?.done) {
    const page = await env.SOURCE.list({
      prefix: "person-erasures/v1/",
      limit: 8,
      cursor: state?.cursor || undefined,
    });
    for (const e of page.objects) {
      const obj = await env.SOURCE.get(e.key);
      if (!obj) throw Error("Person erasure record missing");
      const r = verifyPerson(await obj.json<PersonRecord>(), e.key);
      // Historical draft ownership and the immutable erasure receipt must agree before a missing upload is excused.
      await env.DB.prepare(
        "DELETE FROM restore_missing_uploads AS m WHERE box IN (SELECT value FROM json_each(?1)) OR EXISTS(SELECT 1 FROM drafts WHERE actor=?2 AND id=m.draft AND mailbox_id=m.box) OR EXISTS(SELECT 1 FROM outbox WHERE actor=?2 AND id=m.draft AND mailbox_id=m.box AND state!='sent')",
      )
        .bind(r.boxes, r.target)
        .run();
      await env.TARGET.put(e.key, JSON.stringify(r), { onlyIf: { etagDoesNotMatch: "*" } });
      await env.DB.prepare(
        "INSERT OR IGNORE INTO person_erasures(target,actor,at,boxes,journaled) VALUES(?,?,?,?,1)",
      )
        .bind(r.target, r.actor, r.at, r.boxes)
        .run();
    }
    await env.DB.prepare("INSERT OR REPLACE INTO restore_people VALUES(1,?,?)")
      .bind(page.truncated ? page.cursor : null, Number(!page.truncated))
      .run();
    if (page.truncated) return false;
  }
  if (await env.DB.prepare("SELECT 1 FROM restore_missing_uploads LIMIT 1").first())
    throw Error("Draft attachment missing without a matching erasure receipt");
  return !(await sweepPeople({ DB: env.DB, MAIL: env.TARGET }));
}
