import * as z from "zod/mini";
import { Problem } from "./env";
export async function readJson(req: Request, limit: number) {
  if (req.headers.get("Content-Type")?.split(";")[0] !== "application/json")
    throw new Problem(415, "JSON required");
  const text = await boundedText(req, limit);
  try {
    return z.record(z.string(), z.unknown()).parse(JSON.parse(text));
  } catch {
    throw new Problem(400, "Invalid JSON object");
  }
}

export async function boundedText(req: Request, limit: number) {
  const reader = req.body?.getReader();
  if (!reader) throw new Problem(400, "Missing body");
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Problem(413, "Request too large");
    }
    text += decoder.decode(part.value, { stream: true });
  }
  return text + decoder.decode();
}
