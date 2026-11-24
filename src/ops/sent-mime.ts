import { attachmentType } from "./compose-files";
import { Buffer } from "node:buffer";
import type { Outgoing } from "./outbox";
import type { DraftFile, StoredFile } from "./compose-files";

const crlf = "\r\n";
const wrap = (bytes: Buffer) => bytes.toString("base64").replace(/.{76}(?=.)/g, "$&\r\n");
function filename(name: string) {
  return encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16));
}
type Envelope = { id: string; from_addr: string; reply_addr: string; created_at: string };
type Piece = string | DraftFile;
function plan(item: Envelope, mail: Outgoing, headers: Record<string, string>): Piece[] {
  const words = mail.subject.match(/[\s\S]{1,12}/gu) || [];
  const head = [
    "From: " + item.from_addr,
    ...(mail.to.length ? ["To: " + mail.to.join(",\r\n ")] : []),
    ...(mail.cc.length ? ["Cc: " + mail.cc.join(",\r\n ")] : []),
    "Reply-To: " + item.reply_addr,
    "Subject: " +
      words.map((w) => "=?UTF-8?B?" + Buffer.from(w).toString("base64") + "?=").join("\r\n "),
    "Date: " + new Date(item.created_at).toUTCString(),
    ...Object.entries(headers).map(([k, v]) => k + ": " + v),
    "MIME-Version: 1.0",
  ];
  const boundary = "edge-mail-" + item.id;
  const files = mail.files || [];
  if (files.length)
    head.push('Content-Type: multipart/mixed; boundary="' + boundary + '"', "", "--" + boundary);
  const alt = boundary + "-alternative";
  if (mail.html)
    head.push('Content-Type: multipart/alternative; boundary="' + alt + '"', "", "--" + alt);
  head.push(
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(Buffer.from(mail.body)),
    "",
  );
  if (mail.html)
    head.push(
      "--" + alt,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrap(Buffer.from(mail.html)),
      "--" + alt + "--",
      "",
    );
  const pieces: Piece[] = [head.join(crlf)];
  for (const file of files) {
    pieces.push(
      [
        "--" + boundary,
        "Content-Type: " + attachmentType(file),
        ...(file.inline ? ["Content-ID: <" + file.id + "@edge-mail.invalid>"] : []),
        "Content-Disposition: " +
          (file.inline ? "inline" : "attachment") +
          "; filename*=UTF-8''" +
          filename(file.name),
        "Content-Transfer-Encoding: base64",
        "",
        "",
      ].join(crlf),
      file,
      crlf,
    );
  }
  if (files.length) pieces.push("--" + boundary + "--" + crlf);
  return pieces;
}
export function sentLayout(item: Envelope, mail: Outgoing, headers: Record<string, string>) {
  const pieces = plan(item, mail, headers);
  const size = pieces.reduce((n, p) => {
    if (typeof p === "string") return n + Buffer.byteLength(p);
    const chars = 4 * Math.ceil(p.size / 3);
    return n + chars + 2 * Math.max(0, Math.ceil(chars / 76) - 1);
  }, 0);
  return { size, pieces };
}
export function renderMime(pieces: Piece[], parts: StoredFile[]) {
  const output: string[] = [];
  let index = 0;
  for (const piece of pieces) {
    if (typeof piece === "string") {
      output.push(piece);
      continue;
    }
    const bytes = Buffer.from(parts[index++].content);
    // Each non-final block ends on a base64 line boundary to bound temporary allocations.
    const block = 57 * 1024;
    for (let offset = 0; offset < bytes.length; offset += block) {
      if (offset) output.push(crlf);
      output.push(wrap(bytes.subarray(offset, offset + block)));
    }
  }
  return new Blob(output, { type: "message/rfc822" });
}
