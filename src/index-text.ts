// D1 indexes and matches rules against the same bounded UTF-8 prefix that recovery reads from R2.
export function indexText(body: string) {
  return new TextDecoder().decode(
    new TextEncoder().encode(body.slice(0, 16384)).subarray(0, 16384),
  );
}
