import { RE2JS } from "re2js";
import * as z from "zod/mini";

export type Facts = Record<string, string[]>;
type Match = (facts: Facts) => boolean;
type Compare = (part: string) => boolean;
const fields = new Set([
  "from",
  "sender_domain",
  "to",
  "cc",
  "delivered_to",
  "alias",
  "plus_tag",
  "subject",
  "body",
  "list_id",
  "has_attachment",
  "attachment_type",
  "size",
  "spf",
  "dkim",
  "dmarc",
  "direction",
]);
const leaf = z.strictObject({
  field: z.string(),
  op: z.string(),
  value: z.union([z.string(), z.array(z.string())]),
});
const node = z.record(z.string(), z.unknown());
function invalid(message: string): never {
  throw new SyntaxError(message);
}

function pattern(op: string, value: string): Compare {
  if (value.length > 128) invalid("Patterns can contain at most 128 characters");
  // Exclude groups, counted repetitions and backreferences before the linear-time compiler.
  if (op === "matches" && /[(){}]|\\[1-9]|[?*+]{2}/.test(value))
    invalid("Unsupported pattern construct");
  const source =
    op === "glob"
      ? "^" +
        Array.from(value, (c) => (c === "*" ? ".*" : c === "?" ? "." : RE2JS.quote(c))).join("") +
        "$"
      : value;
  try {
    const re = RE2JS.compile(source, RE2JS.CASE_INSENSITIVE);
    if (re.programSize() > 256) invalid("Pattern is too complex");
    return (input) => re.test(input);
  } catch {
    return invalid("Unsupported mail pattern");
  }
}

function comparison(op: string, value: string | string[]): Compare {
  if (op === "in") {
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.length > 32 ||
      value.some((s) => !s || s.length > 256)
    )
      invalid("Choose 1 to 32 values");
    const values = new Set(value.map((s) => s.toLowerCase()));
    return (s) => values.has(s.toLowerCase());
  }
  if (typeof value !== "string" || !value.length || value.length > 256)
    invalid("Enter a condition value of 1 to 256 characters");
  if (op === "glob" || op === "matches") return pattern(op, value);
  const lower = value.toLowerCase();
  switch (op) {
    case "equals":
      return (s) => s.toLowerCase() === lower;
    case "contains":
      return (s) => s.toLowerCase().includes(lower);
    case "starts_with":
      return (s) => s.toLowerCase().startsWith(lower);
    case "ends_with":
      return (s) => s.toLowerCase().endsWith(lower);
    default:
      return invalid("Unsupported condition operator");
  }
}

export function compileCondition(condition: unknown): Match {
  let count = 0;
  let remaining = 0;
  const exhausted = Symbol("rule evaluation limit");
  function bounded(compare: Compare, value: string) {
    const part = value.slice(0, 16384);
    remaining -= part.length + 1;
    if (remaining < 0) throw exhausted;
    return compare(part);
  }
  function visit(data: unknown, depth: number): Match {
    if (++count > 24 || depth > 5) invalid("Condition tree exceeds the rule budget");
    const obj = node.safeParse(data);
    if (!obj.success) invalid("Enter a condition");
    const keys = Object.keys(obj.data);
    const key = keys[0],
      children = obj.data[key];
    if (keys.length === 1 && key === "not") {
      const child = visit(children, depth + 1);
      return (facts) => !child(facts);
    }
    if (keys.length === 1 && (key === "all" || key === "any")) {
      if (!Array.isArray(children) || !children.length || children.length > 24)
        invalid("Add conditions to the group");
      const parts = children.map((c) => visit(c, depth + 1));
      return key === "all" ? (f) => parts.every((m) => m(f)) : (f) => parts.some((m) => m(f));
    }
    const result = leaf.safeParse(data);
    if (!result.success) invalid("Invalid condition");
    const { field, op, value } = result.data;
    if (!fields.has(field) && !/^header:[a-z0-9-]{1,64}$/.test(field))
      invalid("Unknown condition field");
    const compare = comparison(op, value);
    return (facts) => (facts[field] || []).slice(0, 32).some((s) => bounded(compare, s));
  }
  const match = visit(condition, 0);
  return (facts) => {
    remaining = 131072;
    try {
      return match(facts);
    } catch (error) {
      if (error === exhausted) return false;
      throw error;
    }
  };
}
