const limit = 25 * 1024 * 1024;
const decoder = new TextDecoder();
const fromLine =
  /^From (\S+) +((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) +(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +\d{1,2} +\d\d:\d\d(?::\d\d)?(?: +[A-Z+-][A-Z0-9:+-]*)? +\d{4}(?: +[+-]\d{4})?)(?: remote from \S+)?\r?$/i;
type Delimiter = { start: number; end: number; from: string; date: string };
async function* delimiters(file: Blob, chunk: number) {
  let start = 0,
    length = 0;
  const head = new Uint8Array(512);
  for (let offset = 0; offset < file.size; offset += chunk) {
    const bytes = new Uint8Array(await file.slice(offset, offset + chunk).arrayBuffer());
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] !== 10) {
        if (length < head.length) head[length] = bytes[i];
        length++;
        continue;
      }
      const end = offset + i + 1;
      const hit =
        head[0] === 70 &&
        length <= head.length &&
        fromLine.exec(decoder.decode(head.subarray(0, length)));
      if (hit) yield { start, end, from: hit[1], date: hit[2] };
      start = end;
      length = 0;
    }
  }
}
export async function quoteFrom(file: Blob, escape: boolean) {
  const bytes = new Uint8Array(await file.arrayBuffer()),
    parts: BlobPart[] = [];
  let mark = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (i && bytes[i - 1] !== 10) continue;
    let k = i;
    while (bytes[k] === 62) k++;
    if (!escape && k === i) continue;
    if (
      bytes[k] !== 70 ||
      bytes[k + 1] !== 114 ||
      bytes[k + 2] !== 111 ||
      bytes[k + 3] !== 109 ||
      bytes[k + 4] !== 32
    )
      continue;
    parts.push(file.slice(mark, i));
    if (escape) parts.push(">");
    mark = escape ? i : i + 1;
  }
  return new Blob([...parts, file.slice(mark)]);
}
async function entry(file: Blob, head: Delimiter, end: number) {
  if (end - head.end > limit + 2) throw Error("An archived message exceeds 25 MiB");
  const tail = new Uint8Array(await file.slice(Math.max(head.end, end - 4), end).arrayBuffer());
  if (tail.at(-1) === 10) {
    if (tail.at(-2) === 10) end--;
    else if (tail.at(-2) === 13 && tail.at(-3) === 10) end -= 2;
  }
  if (end === head.end) throw Error("An archive entry has no message");
  return {
    from: head.from,
    date: head.date,
    body: await quoteFrom(file.slice(head.end, end), false),
  };
}
export async function* archiveEntries(file: Blob, chunk = 128 * 1024) {
  let previous: Delimiter | undefined;
  for await (const head of delimiters(file, chunk)) {
    if (previous) yield await entry(file, previous, head.start);
    else if (head.start !== 0) throw Error("Expected an mbox From delimiter at the beginning");
    previous = head;
  }
  if (!previous) throw Error("Expected an mbox From delimiter at the beginning");
  yield await entry(file, previous, file.size);
}
