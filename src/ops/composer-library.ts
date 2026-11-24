import type { Credential } from "../agents/grants";
import { guard, liveWrite } from "../agents/audit";
import { ulid } from "ulid";
import { address } from "../address";
import { Problem, type Bindings, requireValue } from "../env";
import { type User, mailboxAccess, writable } from "./access";
type Args = Record<string, unknown>;
export async function library(
  env: Bindings,
  user: User,
  box: string,
  q: string,
  only?: "contacts" | "templates",
) {
  const eligible = "mailbox_id IN (SELECT b.id " + mailboxAccess + " AND b.id=?)";
  const access = env.DB.prepare("SELECT b.id " + mailboxAccess + " AND b.id=?").bind(user.id, box);
  if (!(await access.first())) throw new Problem(404, "Mailbox unavailable");
  const contacts = env.DB.prepare(
    "SELECT address,name,sent_count FROM contacts WHERE " +
      eligible +
      " AND (instr(lower(name),lower(?))>0 OR instr(address,lower(?))>0) ORDER BY sent_count DESC,last_seen DESC,address LIMIT 50",
  ).bind(user.id, box, q.slice(0, 100), q.slice(0, 100));
  const templates = env.DB.prepare(
    "SELECT id,name,subject,body,rich FROM compose_templates WHERE " +
      eligible +
      " AND actor=? ORDER BY name LIMIT 50",
  ).bind(user.id, box, user.id);
  if (only === "contacts") return { contacts: (await contacts.all()).results };
  if (only === "templates") return { templates: (await templates.all()).results };
  const rows = await env.DB.batch([contacts, templates]);
  return { contacts: rows[0].results, templates: rows[1].results };
}
export async function saveLibrary(
  env: Bindings,
  user: User,
  box: string,
  a: Args,
  c?: Credential,
  dry = false,
) {
  const permission = writable + (c ? " AND EXISTS(" + liveWrite + ")" : "");
  const scope = [user.id, box, ...(c ? guard(c, box) : [])];
  if (
    !(await env.DB.prepare(permission)
      .bind(...scope)
      .first())
  )
    throw new Problem(403, "Mailbox editor required");
  const match = "mailbox_id IN (" + permission + ")";
  let stmt: D1PreparedStatement;
  switch (a.action) {
    case "contact_save": {
      const addr = address(a.address).canonical,
        name = requireValue(a.name, 100);
      stmt = env.DB.prepare(
        "INSERT INTO contacts(mailbox_id,address,name,last_seen) SELECT ?,?,?,? WHERE EXISTS(" +
          permission +
          ") ON CONFLICT(mailbox_id,address) DO UPDATE SET name=excluded.name",
      ).bind(box, addr, name, Date.now(), ...scope);
      break;
    }
    case "contact_remove":
      stmt = env.DB.prepare("DELETE FROM contacts WHERE address=? AND " + match).bind(
        address(a.address).canonical,
        ...scope,
      );
      break;
    case "template_save": {
      const name = requireValue(a.name, 80),
        body = a.body,
        subject = typeof a.subject === "string" ? a.subject : "";
      if (typeof body !== "string" || !body.trim() || body.length > 8000)
        throw new Problem(400, "Use between one and 8,000 characters for a template");
      if (subject.length > 998 || /[\r\n]/.test(subject))
        throw new Problem(400, "Use a single-line subject");
      stmt = env.DB.prepare(
        "INSERT INTO compose_templates SELECT ?,?,?,?,?,?,? WHERE EXISTS(" +
          permission +
          ") AND (SELECT count(*) FROM compose_templates WHERE actor=? AND mailbox_id=?)<50",
      ).bind(
        ulid(),
        box,
        user.id,
        name,
        subject,
        body,
        Number(a.rich === true),
        ...scope,
        user.id,
        box,
      );
      break;
    }
    case "template_remove":
      stmt = env.DB.prepare(
        "DELETE FROM compose_templates WHERE id=? AND actor=? AND " + match,
      ).bind(requireValue(a.id, 26), user.id, ...scope);
      break;
    default:
      throw new Problem(400, "Choose a contact or template action");
  }
  if (dry) return { would_apply: a.action };
  const audit = ulid();
  const [result] = await env.DB.batch([
    stmt,
    ...(c
      ? [
          env.DB.prepare("INSERT INTO agent_audit SELECT ?,?,?,?,?,?,1 WHERE changes()>0").bind(
            audit,
            c.grant,
            user.id,
            box,
            a.action,
            Date.now(),
          ),
        ]
      : []),
  ]);

  if (!result.meta.changes)
    throw new Problem(409, "The item changed or the template limit was reached");
  return { saved: true, ...(c ? { audit_id: audit } : {}) };
}
