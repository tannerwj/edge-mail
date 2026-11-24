// Read just the first header block. Headers.get() can combine duplicate fields.
const HEADER_LIMIT = 128 * 1024;
export function separator(bytes: Uint8Array) {
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] !== 10) continue;
    if (bytes[i + 1] === 10) return i + 2;
    if (bytes[i + 1] === 13 && bytes[i + 2] === 10) return i + 3;
  }
  return -1;
}
export function verdict(header: string) {
  const fields = header.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  const field = fields.find((line) => /^authentication-results:/i.test(line));
  const value = field?.slice(field.indexOf(":") + 1).trim();
  const auth: Record<string, string> = {};
  if (!value || !/^mx\.cloudflare\.net\s*;/i.test(value)) return auth;
  // Strip simple comments before splitting at semicolons. Ambiguous input is unknown.
  const clean = value.replace(/\([^();]*\)/g, "");
  if (/[()"\\]/.test(clean)) return auth;
  for (const clause of clean.split(";").slice(1)) {
    const result =
      /^\s*(spf|dkim|dmarc)=(pass|fail|softfail|neutral|none|temperror|permerror|policy)(?:\s|$)/i.exec(
        clause,
      );
    if (result) auth[result[1].toLowerCase()] ??= result[2].toLowerCase();
  }
  return auth;
}
export async function inspectWire(stream: ReadableStream<Uint8Array>, size: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  const prefix = new Uint8Array(Math.min(size, HEADER_LIMIT));
  let used = 0,
    end = -1;
  while (end < 0 && used < prefix.length) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
    const part = next.value.subarray(0, prefix.length - used);
    prefix.set(part, used);
    const start = Math.max(used - 3, 0);
    used += part.length;
    const boundary = separator(prefix.subarray(start, used));
    if (boundary >= 0) end = start + boundary;
  }
  const auth = verdict(end < 0 ? "" : new TextDecoder().decode(prefix.subarray(0, end)));
  const fixed = new FixedLengthStream(size);
  const replay = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const first = chunks.shift();
      if (first) {
        controller.enqueue(first);
        return;
      }
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { auth, body: fixed.readable, pumping: replay.pipeTo(fixed.writable) };
}
