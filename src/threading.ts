export function subjectKey(subject: string) {
  return subject
    .trim()
    .replace(/^(?:(?:re|fwd?|aw|wg|sv):\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
export function messageIds(header: string) {
  return [...new Set(header.match(/<[\x21-\x3b\x3d\x3f-\x7e]{1,995}>/g) || [])].filter((id) =>
    id.includes("@"),
  );
}
export function replyReferences(references: string, parent: string, limit = 2048) {
  const ids = messageIds(references + " " + parent);
  const first = ids.shift();
  if (!first || first.length > limit) return "";
  let bytes = first.length;
  const recent = [];
  for (const id of ids.reverse()) {
    if (bytes + 1 + id.length > limit) break;
    recent.unshift(id);
    bytes += id.length + 1;
  }
  return [first, ...recent].join(" ");
}
