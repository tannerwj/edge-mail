import { writable } from "../ops/access";
import { createHash, randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { type Bindings, Problem } from "../env";
import { digest, resolveGrant, permits, type Credential } from "./grants";
import { guard, liveWrite } from "./audit";
import { fileSchema, draftFileKey, type DraftFile } from "../ops/compose-files";
import { sourcePart } from "../ops/attachments";
import { MAX_RAW } from "../ops/receipt";

type Row = {
  id: string;
  grant_id: string;
  actor: string;
  mailbox_id: string;
  name: string;
  size: number;
  sha256: string;
  audience: string;
  expires: number;
};
const temporary = (id: string) => "temporary/uploads/" + id;
const maximum = Math.floor((MAX_RAW * 3) / 4);
export async function createUpload(
  env: Bindings,
  c: Credential,
  box: string,
  a: Record<string, unknown>,
  dry: boolean,
) {
  const file = fileSchema.safeParse({ id: a.sha256, name: a.name, size: a.size });
  if (!file.success || file.data.size > maximum)
    throw new Problem(
      400,
      "Supply a filename, byte size and SHA-256 checksum within the attachment limit",
    );
  if (!(await env.DB.prepare(writable).bind(c.user.id, box).first()))
    throw new Problem(403, "Mailbox editor required");
  if (dry) return { would_create: true, maximum_bytes: maximum };
  const id = ulid(),
    token = randomBytes(32).toString("base64url"),
    now = Date.now();
  const expiry = Math.min(now + 3600000, c.expires),
    put = Math.min(now + 300000, expiry);
  const [saved] = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO agent_uploads SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(" +
        liveWrite +
        ") AND EXISTS(" +
        writable +
        ") AND (SELECT count(*) FROM agent_uploads WHERE actor=? AND expires>?)<16",
    ).bind(
      id,
      digest(token),
      c.grant,
      c.user.id,
      box,
      file.data.name,
      file.data.size,
      file.data.id,
      c.audience,
      put,
      expiry,
      ...guard(c, box),
      c.user.id,
      box,
      c.user.id,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO agent_audit SELECT ?,?,?,?,'upload_create',?,1 WHERE changes()=1",
    ).bind(ulid(), c.grant, c.user.id, box, now),
  ]);
  if (!saved.meta.changes)
    throw new Problem(409, "Access changed or all 16 active upload slots are in use");
  return {
    upload_id: id,
    url: c.audience + "/v1/uploads/" + token,
    method: "PUT",
    upload_expires: put,
    reference_expires: expiry,
  };
}
export async function receiveUpload(env: Bindings, req: Request, ticket: string, url: URL) {
  if (req.method !== "PUT") throw new Problem(405, "Use PUT for upload bytes");
  const row = await env.DB.prepare(
    "SELECT * FROM agent_uploads WHERE ticket_hash=? AND audience=? AND put_until>?",
  )
    .bind(digest(ticket), url.origin, Date.now())
    .first<Row>();
  if (!row) throw new Problem(404, "Upload link expired or unavailable");
  const c = await resolveGrant(env, row.grant_id, url.origin);
  if (
    c.user.id !== row.actor ||
    !permits(c.scopes, "mail.write") ||
    (c.boxes && !c.boxes.includes(row.mailbox_id)) ||
    !(await env.DB.prepare(writable).bind(c.user.id, row.mailbox_id).first())
  )
    throw new Problem(403, "Upload access changed");
  if (req.headers.get("content-length") !== String(row.size))
    throw new Problem(400, "Upload size differs from the reservation");
  const key = temporary(row.id);
  try {
    await env.MAIL.put(key, req.body || new Uint8Array(), {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: Buffer.from(row.sha256, "hex"),
    });
  } catch (err) {
    if (err instanceof Error && /digest|checksum/i.test(err.message))
      throw new Problem(400, "Upload checksum mismatch");
    throw err;
  }
  return Response.json({ upload_id: row.id, size: row.size });
}
type Ref = { upload_id?: string; message_id?: string; attachment_id?: number };
async function material(env: Bindings, c: Credential, box: string, ref: Ref) {
  if (ref && typeof ref.upload_id === "string" && ref.message_id === undefined) {
    const row = await env.DB.prepare(
      "SELECT * FROM agent_uploads WHERE id=? AND grant_id=? AND actor=? AND mailbox_id=? AND expires>?",
    )
      .bind(ref.upload_id, c.grant, c.user.id, box, Date.now())
      .first<Row>();
    if (!row) throw new Problem(404, "Upload reference unavailable");
    return { key: temporary(row.id), name: row.name, size: row.size, sha: row.sha256 };
  }
  if (
    ref &&
    typeof ref.message_id === "string" &&
    Number.isSafeInteger(ref.attachment_id) &&
    ref.attachment_id !== undefined &&
    ref.upload_id === undefined
  ) {
    const entry = await sourcePart(env, c.user.id, box, ref.message_id, ref.attachment_id);
    return { ...entry, sha: null };
  }
  throw new Problem(400, "Choose an upload or a message attachment");
}
export async function referencedFiles(
  env: Bindings,
  c: Credential,
  box: string,
  id: string | null,
  refs: unknown,
) {
  if (!Array.isArray(refs) || refs.length > 32)
    throw new Problem(400, "Choose at most 32 attachment references");
  const files: DraftFile[] = [];
  let size = 0;
  for (const ref of refs) {
    const m = await material(env, c, box, ref);
    size += m.size;
    if (size > maximum) throw new Problem(413, "The encoded message exceeds 25 MiB");
    const object = await env.MAIL.get(m.key);
    if (!object || object.size !== m.size)
      throw new Problem(409, "Upload the attachment bytes first");
    if (!id) {
      await object.body.cancel();
      continue;
    }
    const bytes = await object.arrayBuffer();
    const hash = m.sha || createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
    const file = fileSchema.safeParse({ name: m.name, size: m.size, id: hash });
    if (!file.success) throw new Problem(400, "Invalid attachment filename or size");
    await env.MAIL.put(draftFileKey(box, id, hash), bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: Buffer.from(hash, "hex"),
    });
    files.push(file.data);
  }
  return files;
}
export async function sweepUploads(env: Bindings) {
  const rows = await env.DB.prepare(
    "SELECT id FROM agent_uploads WHERE expires<? ORDER BY expires LIMIT 64",
  )
    .bind(Date.now() - 600000)
    .all<{ id: string }>();
  if (!rows.results.length) return;
  const ids = rows.results.map((r) => r.id);
  await env.MAIL.delete(ids.map(temporary));
  await env.DB.prepare("DELETE FROM agent_uploads WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids))
    .run();
}
