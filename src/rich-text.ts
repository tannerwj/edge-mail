const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
type Image = { id: string; name: string; inline?: string };
export function textParts(body: string) {
  let offset = 0;
  return body.split(/(\*\*[^*\n]+\*\*|_[^_\n]+_)/).map((part, i) => {
    const start = offset;
    offset += part.length;
    if (i % 2 === 0) return { start, style: "text", text: part };
    return part.startsWith("**")
      ? { start, style: "strong", text: part.slice(2, -2) }
      : { start, style: "em", text: part.slice(1, -1) };
  });
}
export function formatText(body: string, rich: boolean, files: Image[]) {
  const images = files.filter((f) => f.inline);
  if (!rich && !images.length) return { text: body, html: undefined };
  const parts = rich ? textParts(body) : [{ style: "text", text: body }];
  const text = parts.map((p) => p.text).join("");
  const content = parts
    .map((p) =>
      p.style === "text"
        ? escape(p.text)
        : "<" + p.style + ">" + escape(p.text) + "</" + p.style + ">",
    )
    .join("")
    .replace(/\r?\n/g, "<br>");
  const html =
    "<p>" +
    content +
    "</p>" +
    images
      .map(
        (f) =>
          '<p><img src="cid:' +
          escape(f.id) +
          '@edge-mail.invalid" alt="' +
          escape(f.name) +
          '"></p>',
      )
      .join("");
  return { text, html };
}
