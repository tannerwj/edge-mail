import { rasterType } from "../raster";
import * as z from "zod/mini";
import { Buffer } from "node:buffer";
import { type Bindings, type Principal, Problem } from "../env";
import { human, writable } from "./access";
import { MAX_RAW } from "./receipt";

export const fileSchema = z.object({
  id: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
  name: z.string().check(z.minLength(1), z.maxLength(180), z.regex(/^[^/\\\p{Cc}\p{Cf}]+$/u)),
  calendar: z.optional(z.literal("reply")),
  inline: z.optional(z.enum(["image/png", "image/jpeg", "image/gif"])),
  size: z.number().check(z.int(), z.minimum(0), z.maximum(MAX_RAW)),
});
export type DraftFile = z.infer<typeof fileSchema>;
export const attachmentType = (file: DraftFile) =>
  file.inline ||
  (file.calendar === "reply"
    ? "text/calendar; method=REPLY; charset=UTF-8"
    : "application/octet-stream");
export const draftFileKey = (box: string, draft: string, id: string) =>
  "att/uploads/" + box + "/" + draft + "/" + id;

export async function uploadFile(
  env: Bindings,
  p: Principal,
  box: string,
  draft: string,
  id: string,
  request: Request,
) {
  const actor = human(p).id;
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Problem(400, "Invalid attachment digest");
  const owned = await env.DB.prepare(
    `SELECT 1 FROM drafts WHERE discarded_until IS NULL AND id=? AND actor=? AND mailbox_id IN (${writable})`,
  )
    .bind(draft, actor, actor, box)
    .first();
  if (!owned) throw new Problem(404, "Draft unavailable");
  const length = request.headers.get("content-length");
  if (!length || !/^\d+$/.test(length)) throw new Problem(411, "Attachment length required");
  const size = Number(length);
  if (size > Math.floor((MAX_RAW * 3) / 4))
    throw new Problem(413, "The encoded message exceeds 25 MiB");
  const path = draftFileKey(box, draft, id);
  if (!(await env.MAIL.head(path))) {
    // R2 verifies the claimed digest and content length before committing the immutable object.
    try {
      await env.MAIL.put(path, request.body || new Uint8Array(), {
        sha256: Buffer.from(id, "hex"),
        onlyIf: { etagDoesNotMatch: "*" },
      });
    } catch (error) {
      if (error instanceof Error && /checksum|digest/i.test(error.message))
        throw new Problem(400, "Attachment checksum mismatch");
      throw error;
    }
  }
  const stored = await env.MAIL.head(path);
  if (stored?.size !== size) throw new Problem(409, "Attachment length mismatch");
  return { id, size };
}

export type StoredFile = { filename: string; type: string; content: ArrayBuffer } & (
  | { disposition: "attachment" }
  | { disposition: "inline"; contentId: string }
);
function verifyImage(bytes: ArrayBuffer, type: string) {
  if (rasterType(bytes) !== type)
    throw new Problem(
      400,
      "Inline images must contain a PNG, JPEG or GIF matching the selected type",
    );
}
export async function storedFiles(
  env: Bindings,
  box: string,
  id: string,
  files: DraftFile[],
  read: boolean,
) {
  const parts: StoredFile[] = [];
  for (const file of files) {
    const path = draftFileKey(box, id, file.id);
    if (read || file.inline) {
      const obj = await env.MAIL.get(path, read ? undefined : { range: { offset: 0, length: 12 } });
      if (obj?.size !== file.size)
        throw new Problem(409, "Reattach the missing file before sending");
      const content = await obj.arrayBuffer();
      if (file.inline) verifyImage(content, file.inline);
      if (!read) continue;
      parts.push({
        filename: file.name,
        type: attachmentType(file),
        ...(file.inline
          ? { disposition: "inline" as const, contentId: file.id + "@edge-mail.invalid" }
          : { disposition: "attachment" as const }),
        content,
      });
    } else if ((await env.MAIL.head(path))?.size !== file.size) {
      throw new Problem(409, "Reattach the missing file before sending");
    }
  }
  return parts;
}
