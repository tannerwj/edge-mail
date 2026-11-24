type SearchValue = string | number;
export type SearchTerm = { key: string; value: SearchValue; negative: boolean };
const choices: Record<string, readonly string[]> = {
  has: ["attachment"],
  is: ["read", "unread", "starred"],
  in: ["inbox", "sent", "archive", "spam", "trash", "anywhere", "snoozed", "follow-ups"],
};
const fields = new Set([
  "text",
  "from",
  "to",
  "cc",
  "subject",
  "domain",
  "label",
  "has",
  "is",
  "in",
  "before",
  "after",
  "older_than",
  "newer_than",
  "larger",
]);
const duration: Record<string, number> = { d: 1, m: 30, y: 365 };
const units: Record<string, number> = { "": 1, k: 1024, m: 1048576, g: 1073741824 };
function invalid(): never {
  throw new SyntaxError("Invalid mail search");
}
function valueFor(key: string, raw: string, now: number): SearchValue {
  const lower = raw.toLowerCase();
  if (choices[key]) return choices[key].includes(lower) ? lower : invalid();
  if (key === "before" || key === "after") {
    const date = new Date(raw + "T00:00:00.000Z");
    if (
      !/^\d{4}-\d\d-\d\d$/.test(raw) ||
      !Number.isFinite(date.valueOf()) ||
      !date.toISOString().startsWith(raw)
    )
      invalid();
    return date.toISOString();
  }
  if (key === "older_than" || key === "newer_than") {
    const match = /^(\d{1,5})([dmy])$/.exec(lower);
    if (!match) invalid();
    return new Date(now - Number(match[1]) * duration[match[2]] * 86400000).toISOString();
  }
  if (key === "larger") {
    const size = /^(\d{1,12})([kmg]?)b?$/.exec(lower);
    if (!size) invalid();
    const bytes = Number(size[1]) * units[size[2]];
    return Number.isSafeInteger(bytes) ? bytes : invalid();
  }
  return raw;
}
export function parseSearch(input: string, now = Date.now(), tokens?: string[]) {
  if (input.length > 1024) invalid();
  const query = input.trim(),
    terms: SearchTerm[] = [];
  const token = /(-)?(?:([a-z_]+):)?(?:"([^"]+)"|([^"\s]+))(?=\s|$)/iy;
  let index = 0;
  while (index < query.length) {
    token.lastIndex = index;
    const match = token.exec(query);
    if (!match || terms.length >= 24) invalid();
    const key = (match[2] || "text").toLowerCase(),
      raw = match[3] ?? match[4];
    if (!fields.has(key) || (key === "text" && /^[a-z_]+:$/i.test(raw))) invalid();
    terms.push({ key, value: valueFor(key, raw, now), negative: !!match[1] });
    tokens?.push(match[0]);
    index = token.lastIndex;
    while (index < query.length && /\s/.test(query[index])) index++;
  }
  return terms;
}
