import { visibleInbox, snoozedMail, followUpMail } from "./thread-views";
const views: Record<string, string> = {
  inbox: "(m.folder='inbox' AND " + visibleInbox + ")",
  snoozed: "(" + snoozedMail + ")",
  "follow-ups": followUpMail,
};
import { Problem } from "../env";
import { parseSearch, type SearchTerm } from "../search";
const condition: Record<string, string> = {
  from: "instr(lower(m.sender),lower(?))>0",
  domain: "lower(substr(m.sender,instr(m.sender,'@')+1))=lower(?)",
  to: "(instr(lower(md.recipients),lower(?))>0 OR EXISTS(SELECT 1 FROM deliveries d WHERE d.message_id=m.id AND d.mailbox_id=m.mailbox_id AND instr(lower(d.envelope_to),lower(?))>0))",
  cc: "instr(lower(md.cc),lower(?))>0",
  subject: "instr(lower(m.subject),lower(?))>0",
  label:
    "EXISTS(SELECT 1 FROM message_labels l WHERE l.mailbox_id=m.mailbox_id AND l.message_id=m.id AND l.label=?)",
  text: "m.rowid IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ?)",
  before: "m.received_at<?",
  after: "m.received_at>=?",
  older_than: "m.received_at<?",
  newer_than: "m.received_at>=?",
  larger: "md.raw_bytes>?",
};
const status: Record<string, string> = {
  read: "m.is_read=1",
  unread: "m.is_read=0",
  starred: "m.starred=1",
};
function predicate(term: SearchTerm, params: (string | number)[]) {
  const { key, value } = term;
  if (key === "is") return status[value];
  if (key === "has") return "m.attachment_count>0";
  if (key === "in" && value === "anywhere") return "1";
  if (key === "in" && views[value]) return views[value];
  if (key === "to") params.push(value);
  params.push(key === "text" ? '"' + String(value).replaceAll('"', '""') + '"' : value);
  return key === "in" ? "m.folder=?" : condition[key];
}
const folders = new Set([
  "inbox",
  "archive",
  "spam",
  "trash",
  "sent",
  "starred",
  "unread",
  "anywhere",
  "snoozed",
  "follow-ups",
]);
export function filterMessages(search: URLSearchParams) {
  const query = search.get("q") || "",
    folder = search.get("folder") || (query ? "anywhere" : "inbox");
  if (!folders.has(folder)) throw new Problem(400, "Unknown folder");
  let terms;
  try {
    terms = parseSearch(query);
  } catch {
    throw new Problem(400, "Invalid search expression");
  }
  const clauses: string[] = [],
    params: (string | number)[] = [];
  if (folder !== "anywhere" && !status[folder] && !views[folder]) {
    clauses.push("m.folder=?");
    params.push(folder);
  } else if (!terms.some((t) => t.key === "in" && !t.negative)) {
    clauses.push("m.folder NOT IN ('spam','trash')");
  }
  if (views[folder]) clauses.push(views[folder]);
  if (status[folder]) clauses.push(status[folder]);
  for (const term of terms)
    clauses.push((term.negative ? "NOT " : "") + "(" + predicate(term, params) + ")");
  return { sql: clauses.join(" AND ") || "1", params };
}
