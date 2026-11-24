import { guard as writeGuard, liveWrite } from "./audit";
import { ulid } from "ulid";
import { type Bindings, Problem, requireValue } from "../env";
import { administrator } from "../ops/access";
import { people } from "../ops/people";
import { operatingLimits } from "../ops/budgets";
import { chainSql, type Credential } from "./grants";
import { address, domainName } from "../address";
import { writesOn } from "../ops/budgets";
// Directory changes can grant access to future mailboxes. Only an unrestricted instance administrator may make them.
const liveAdmin =
  chainSql +
  " SELECT 1 WHERE " +
  writesOn +
  " AND EXISTS(SELECT 1 FROM ancestors WHERE parent IS NULL) AND NOT EXISTS(SELECT 1 FROM ancestors a JOIN users u ON a.actor=u.id WHERE a.revoked IS NOT NULL OR a.expires<=? OR a.actor!=? OR a.audience!=? OR a.boxes IS NOT NULL OR u.disabled_at IS NOT NULL OR u.role NOT IN ('admin','owner') OR NOT EXISTS(SELECT 1 FROM json_each(a.scopes) WHERE value='admin') OR EXISTS(SELECT 1 FROM grant_policies p WHERE p.grant_id=a.id AND (p.send_mode!='allow' OR p.review_egress=1 OR p.recipients IS NOT NULL OR p.daily_cap IS NOT NULL)))";
const descendants =
  "SELECT g.* FROM grant_lineage l JOIN agent_grants g ON g.id=l.leaf WHERE l.ancestor=? AND g.id!=? AND g.actor=?";
export async function grantDirectory(
  env: Bindings,
  c: Credential,
  name: string,
  args: Record<string, unknown>,
  dry: boolean,
) {
  const bind = [c.grant, c.grant, c.user.id];
  if (name === "grant_list" || name === "token_list")
    return (
      await env.DB.prepare(
        "SELECT g.id,g.name,g.parent,g.expires,g.revoked,g.scopes,g.boxes FROM (" +
          descendants +
          ") g " +
          (name === "token_list"
            ? "WHERE EXISTS(SELECT 1 FROM agent_tokens t WHERE t.grant_id=g.id) "
            : "") +
          "ORDER BY created DESC LIMIT 200",
      )
        .bind(...bind)
        .all()
    ).results;
  const target = requireValue(args.id, 26);
  const condition = "id IN(SELECT id FROM (" + descendants + ")) AND id=? AND revoked IS NULL";
  const row = await env.DB.prepare("SELECT id FROM agent_grants WHERE " + condition)
    .bind(...bind, target)
    .first();
  if (!row) throw new Problem(404, "Delegated grant unavailable");
  if (dry) return { would_revoke: target };
  const [change] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE agent_grants SET revoked=? WHERE " +
        condition +
        " AND EXISTS(" +
        liveWrite +
        ") AND EXISTS(SELECT 1 FROM users WHERE id=? AND disabled_at IS NULL)",
    ).bind(Date.now(), ...bind, target, ...writeGuard(c, c.boxes?.[0] || ""), c.user.id),
    env.DB.prepare("INSERT INTO agent_audit SELECT ?,?,?,NULL,?,?,1 WHERE changes()=1").bind(
      ulid(),
      c.grant,
      c.user.id,
      name,
      Date.now(),
    ),
  ]);
  if (!change.meta.changes) throw new Problem(409, "Grant changed");
  return { revoked: true };
}
export async function directory(
  env: Bindings,
  c: Credential,
  name: string,
  args: Record<string, unknown>,
  dry: boolean,
) {
  if (name.startsWith("grant_") || name.startsWith("token_"))
    return grantDirectory(env, c, name, args, dry);
  administrator(c.user);
  if (c.boxes !== null) throw new Problem(403, "Instance-wide administrator grant required");
  if (name === "settings_get") return operatingLimits(env, c.user);
  if (name === "user_list") return people(env, c.user);
  if (name === "domain_list")
    return (await env.DB.prepare("SELECT id,name FROM domains ORDER BY name LIMIT 1000").all())
      .results;
  const id = ulid(),
    actor = c.user.id,
    guard = [c.grant, Date.now(), actor, c.audience];
  if (
    !(await env.DB.prepare(liveAdmin)
      .bind(...guard)
      .first())
  )
    throw new Problem(403, "Unrestricted administrator grant required");
  const tx = await directoryInsert(env, { actor, id, guard }, name, args);
  if (dry) return { would_create: true };
  tx.push(
    env.DB.prepare("INSERT INTO agent_audit SELECT ?,?,?,NULL,?,?,1 WHERE changes()=1").bind(
      ulid(),
      c.grant,
      actor,
      name,
      Date.now(),
    ),
  );
  const [first] = await env.DB.batch(tx);
  if (!first.meta.changes) throw new Problem(409, "Permission or directory entry changed");
  return { id };
}
type Insert = { actor: string; id: string; guard: (string | number)[] };
async function directoryInsert(
  env: Bindings,
  run: Insert,
  name: string,
  args: Record<string, unknown>,
) {
  const { actor, id, guard } = run,
    db = env.DB,
    gate = " WHERE EXISTS(" + liveAdmin + ")";
  if (name === "domain_add")
    return [
      db
        .prepare("INSERT INTO domains SELECT ?,?,?" + gate)
        .bind(id, domainName(args.name), actor, ...guard),
    ];
  if (name === "user_add")
    return [
      db.prepare("INSERT INTO users(id,role) SELECT ?,'member'" + gate).bind(id, ...guard),
      db
        .prepare("INSERT INTO user_emails SELECT ?,id FROM users WHERE id=?")
        .bind(address(args.email).canonical, id),
    ];
  const a = address(args.address),
    title = requireValue(args.name, 120);
  const zone = await db
    .prepare("SELECT id FROM domains WHERE name=?")
    .bind(a.host)
    .first<string>("id");
  if (!zone) throw new Problem(400, "Add the mailbox domain first");
  return [
    db
      .prepare("INSERT INTO mailboxes SELECT ?,?,?,?,?" + gate)
      .bind(id, zone, a.original, title, actor, ...guard),
    db
      .prepare("INSERT INTO mailbox_members SELECT id,?,'owner' FROM mailboxes WHERE id=?")
      .bind(actor, id),
    db
      .prepare("INSERT INTO addresses SELECT ?,?,id,'primary' FROM mailboxes WHERE id=?")
      .bind(a.canonical, a.original, id),
  ];
}
