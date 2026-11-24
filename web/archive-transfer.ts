import { Zip, ZipPassThrough } from "fflate";
import * as z from "zod/mini";
import { api } from "./api";
import { archiveEntries, quoteFrom } from "./mbox";
const item = z.object({
  id: z.string(),
  sender: z.string(),
  received_at: z.string(),
  wire_id: z.string(),
  folder: z.string(),
  is_read: z.number(),
  starred: z.number(),
  labels: z.string(),
});
const page = z.object({ items: z.array(item), next: z.nullable(z.string()) });
type Tick = (count: number) => void;
async function checked(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, redirect: "error" });
  if (!res.ok) throw Error((await res.json()).error || "Archive request failed");
  return res;
}
export async function importArchive(box: string, file: File, tick: Tick) {
  let count = 0;
  for await (const msg of archiveEntries(file)) {
    await checked("/api/mailboxes/" + box + "/archive", {
      method: "POST",
      headers: {
        "content-type": "message/rfc822",
        "x-archive-from": /^[\x21-\x7e]{1,254}$/.test(msg.from) ? msg.from : "MAILER-DAEMON",
        "x-archive-date": msg.date,
      },
      body: msg.body,
    });
    tick(++count);
  }
  return count;
}
async function sink(name: string) {
  const picker = (
    window as Window & {
      showSaveFilePicker?: (opts: { suggestedName: string }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  if (picker) {
    const handle = await picker.call(window, { suggestedName: name });
    return handle.createWritable();
  }
  const parts: Blob[] = [];
  let size = 0;
  return {
    write: (part: Blob) => {
      size += part.size;
      if (size > 256 * 1024 * 1024)
        throw Error("Use a browser with Save File support for archives larger than 256 MiB");
      parts.push(part);
    },
    close: () => {
      const url = URL.createObjectURL(new Blob(parts)),
        a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    abort: () => {
      parts.length = 0;
    },
  };
}
function ctime(value: string) {
  const d = new Date(value),
    [day, date, month, year, time] = d.toUTCString().split(" ");
  return [day.slice(0, 3), month, date, time, year].join(" ");
}
async function mboxPart(raw: Blob, m: z.infer<typeof item>) {
  const sender = /^[!-~]+$/.test(m.sender) ? m.sender : "MAILER-DAEMON";
  const newline = (await raw.slice(-1).text()) === "\n" ? "\n" : "\n\n";
  return new Blob([
    "From " + sender + " " + ctime(m.received_at) + "\n",
    await quoteFrom(raw, true),
    newline,
  ]);
}
function zipper() {
  let chunks: BlobPart[] = [];
  const zip = new Zip((error, data) => {
    if (error) throw error;
    chunks.push(new Uint8Array(data));
  });
  function drain() {
    const b = new Blob(chunks);
    chunks = [];
    return b;
  }
  return {
    add: async (name: string, body: Blob) => {
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      entry.push(new Uint8Array(await body.arrayBuffer()), true);
      return drain();
    },
    end: () => {
      zip.end();
      return drain();
    },
  };
}
export async function exportArchive(
  box: string,
  address: string,
  format: "mbox" | "zip",
  tick: Tick,
) {
  const file = await sink(address + "." + format),
    zip = format === "zip" ? zipper() : null;
  const path = "mailboxes/" + box;
  let after: string | null = null,
    count = 0;
  try {
    do {
      const rows = page.parse(
        await api(path + "/archive" + (after ? "?after=" + encodeURIComponent(after) : "")),
      );
      if (zip && rows.items.length)
        await file.write(
          await zip.add(
            "metadata/messages-" + count + ".json",
            new Blob([
              JSON.stringify(rows.items.map((m) => ({ ...m, labels: JSON.parse(m.labels) }))),
            ]),
          ),
        );
      for (const m of rows.items) {
        if (zip && count >= 64000)
          throw Error("ZIP entry limit reached. Export this mailbox as mbox.");
        const raw = await (await checked("/api/" + path + "/archive/" + m.id)).blob();
        await file.write(
          zip ? await zip.add("messages/" + m.id + ".eml", raw) : await mboxPart(raw, m),
        );
        tick(++count);
      }
      after = rows.next;
    } while (after);
    if (zip) {
      const rules = await api(path + "/rules");
      await file.write(await zip.add("metadata/rules.json", new Blob([JSON.stringify(rules)])));
      await file.write(zip.end());
    }
    await file.close();
    return count;
  } catch (error) {
    await file.abort();
    throw error;
  }
}
