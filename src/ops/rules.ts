import { isOutboundAction, checkNotificationTargets } from "./rule-notifications";
import { address } from "../address";
import { restrictedRelay } from "../agents/policies";
import {
  pendingReview,
  finishReview,
  requireEgressApproval,
  propose,
} from "../agents/review-request";
import { egressNotice } from "./notices";
import { wakePush } from "./push";
import { guard, liveWrite } from "../agents/audit";
import type { Credential } from "../agents/grants";
import { owner } from "./destinations";
import { headersOnly } from "./forward";
import PostalMime from "postal-mime";
import { ulid } from "ulid";
import { type Bindings, type Principal, Problem } from "../env";
import { compileCondition } from "../rule-matcher";
import { human, mailboxAccess } from "./access";
import {
  effective,
  authorized,
  definition,
  manageScope,
  type Definition,
  type Rule,
} from "./rule-definitions";
import { mailFacts, ruleActions } from "./rule-engine";
import type { Receipt } from "./receipt";
import { changed } from "../live";

async function history(env: Bindings, p: Principal, box: string, id: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM rule_versions WHERE rule_id=? ORDER BY revision DESC LIMIT 1",
  )
    .bind(id)
    .first<Rule>();
  if (!row) throw new Problem(404, "Rule unavailable");
  const scopeId = await manageScope(env, p, box, row.scope);
  if (scopeId !== row.scope_id) throw new Problem(404, "Rule unavailable");
  return row;
}
export async function ruleDetail(env: Bindings, p: Principal, box: string, id: string) {
  await history(env, p, box, id);
  const [versions, runs, forwards] = await env.DB.batch([
    env.DB.prepare(
      "SELECT revision,document,editor,at FROM rule_versions WHERE rule_id=? ORDER BY revision DESC LIMIT 100",
    ).bind(id),
    env.DB.prepare(
      "SELECT revision,message_id,actions,at FROM rule_runs WHERE rule_id=? AND mailbox_id=? ORDER BY at DESC,rowid DESC LIMIT 100",
    ).bind(id, box),
    env.DB.prepare(
      "SELECT id,mode,state,reason,at FROM forward_attempts WHERE rule_id=? AND mailbox_id=? ORDER BY at DESC LIMIT 100",
    ).bind(id, box),
  ]);
  return { versions: versions.results, runs: runs.results, forwards: forwards.results };
}

async function recent(env: Bindings, p: Principal, box: string, doc: Definition) {
  const match = compileCondition(doc.condition);
  const rows = await env.DB.prepare(`SELECT m.id,m.subject,m.body_key,
    (SELECT raw_key FROM deliveries d WHERE d.mailbox_id=m.mailbox_id AND d.message_id=m.id ORDER BY received_at,id LIMIT 1) AS raw_key
    FROM messages m WHERE m.mailbox_id IN (SELECT b.id ${mailboxAccess} AND b.id=?) AND EXISTS
    (SELECT 1 FROM deliveries d WHERE d.message_id=m.id AND d.mailbox_id=m.mailbox_id)
    ORDER BY m.received_at DESC,m.id DESC LIMIT 20`)
    .bind(human(p).id, box)
    .all<{ id: string; subject: string; raw_key: string; body_key: string }>();
  const matches: { id: string; subject: string }[] = [];
  let scanned = 0,
    bytes = 0;
  for (const m of rows.results) {
    const raw = await env.MAIL.get(m.raw_key);
    if (!raw?.customMetadata?.receipt) throw new Problem(503, "A retained receipt is unavailable");
    if ((bytes += raw.size) > 32 * 1024 * 1024) {
      await raw.body.cancel();
      break;
    }
    const meta: Receipt = JSON.parse(raw.customMetadata.receipt);
    const parsed = await PostalMime.parse(await raw.arrayBuffer());
    const body = await env.MAIL.get(m.body_key, { range: { offset: 0, length: 16384 } });
    if (match(mailFacts(parsed, meta, body ? await body.text() : "", raw.size)))
      matches.push({ id: m.id, subject: m.subject });
    scanned++;
  }
  return { scanned, matches };
}

async function validateReplyThrough(env: Bindings, box: string, mode: string) {
  const mailbox = await env.DB.prepare("SELECT address FROM mailboxes WHERE id=?")
    .bind(box)
    .first<string>("address");
  if (!mailbox || mode !== "resend")
    throw new Problem(400, "Choose queued resend for reply-through");
  const { local, host } = address(mailbox);
  if (local.includes("+"))
    throw new Problem(400, "Choose a primary mailbox without a plus tag for reply-through");
  address(local + "+emr-" + "0".repeat(32) + "@" + host);
}
async function validateForward(
  env: Bindings,
  p: Principal,
  box: string,
  scope: string,
  doc: Definition,
) {
  await checkNotificationTargets(env, p, box, scope, doc);
  if (doc.actions.some((a) => a.kind === "auto_reply")) {
    if (scope !== "mailbox")
      throw new Problem(400, "Choose the sending mailbox for an automatic reply");
    await owner(env, p, box);
  }
  const forwards = doc.actions.filter((a) => a.kind === "forward");
  if (forwards.length) {
    if (scope !== "mailbox")
      throw new Problem(400, "Choose the owning mailbox for a forwarding rule");
    await owner(env, p, box);
    if (!doc.enabled) return;
    if (forwards.some((a) => a.mode === "relay")) {
      const rows = await env.DB.prepare(effective).bind(box).all<Rule>();
      for (const row of rows.results) {
        const prior = definition(JSON.parse(row.document));
        if (
          prior.stop &&
          (row.scope !== "mailbox" || prior.order <= doc.order) &&
          !headersOnly(prior.condition)
        )
          throw new Problem(409, "An earlier stop needs parsed content. Use queued resend.");
      }
    }
    for (const a of forwards) {
      if (a.reply_through) await validateReplyThrough(env, box, a.mode);
      if (a.mode === "relay" && !headersOnly(doc.condition))
        throw new Problem(400, "Choose queued resend for a parsed-content condition");
      if (
        a.mode === "relay" &&
        (await env.DB.prepare(
          "SELECT 1 FROM mailbox_screening WHERE mailbox_id=? AND (learn=1 OR screen_unknown=1)",
        )
          .bind(box)
          .first())
      )
        throw new Problem(400, "Choose queued resend when sender or content screening is enabled");
      const current = await env.DB.prepare(
        "SELECT 1 FROM egress_destinations WHERE id=? AND mailbox_id=? AND disabled=0 AND verified_at IS NOT NULL",
      )
        .bind(a.destination, box)
        .first();
      if (!current) throw new Problem(409, "Verify the forwarding destination first");
    }
  }
}

async function editedDefinition(env: Bindings, old: Rule | null, input: Record<string, unknown>) {
  let content = input.document;
  if (old && typeof input.enabled === "boolean")
    content = { ...definition(JSON.parse(old.document)), enabled: input.enabled };
  if (input.restore !== undefined && old) {
    const row = await env.DB.prepare(
      "SELECT document FROM rule_versions WHERE rule_id=? AND revision=?",
    )
      .bind(old.rule_id, Number(input.restore))
      .first<string>("document");
    if (!row) throw new Problem(404, "Rule version unavailable");
    content = JSON.parse(row);
  }
  return definition(content);
}
function ruleJournal(
  env: Bindings,
  credential: Credential | undefined,
  box: string,
  ruleId: string,
  revision: number,
  audit: string,
) {
  return credential
    ? [
        env.DB.prepare(
          "INSERT INTO delegated_rules(rule_id,revision,grant_id,actor,mailbox_id,audience,audit_id) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
        ).bind(
          ruleId,
          revision,
          credential.grant,
          credential.user.id,
          box,
          credential.audience,
          audit,
        ),
        env.DB.prepare(
          "INSERT INTO agent_audit SELECT audit_id,grant_id,actor,mailbox_id,'rule_upsert',?,1 FROM delegated_rules WHERE audit_id=?",
        ).bind(Date.now(), audit),
        egressNotice(env, audit),
      ]
    : [];
}
async function authorizePriorRule(env: Bindings, p: Principal, box: string, old: Rule | null) {
  if (old && definition(JSON.parse(old.document)).actions.some(isOutboundAction))
    await owner(env, p, box);
}
function editScope(old: Rule | null, requested: unknown, credential?: Credential) {
  const scope = old?.scope ?? requested;
  if (typeof scope !== "string") throw new Problem(400, "Choose a rule scope");
  if (credential && scope !== "mailbox") throw new Problem(403, "Choose the authorized mailbox");
  return scope;
}
async function checkRulePolicy(
  env: Bindings,
  c: Credential,
  box: string,
  doc: Definition,
  edit: { review?: string; id?: string; revision: number; scope: string; dry: boolean },
) {
  if (!doc.enabled) return null;
  const egress = doc.actions.filter(isOutboundAction);
  if (
    egress.some((a) => a.kind === "forward" && (a.mode === "relay" || a.reply_through)) &&
    (await restrictedRelay(env, c.grant))
  )
    throw new Problem(400, "Choose queued resend so the grant’s sending limits can be applied");
  if (!egress.length || edit.review || !(await requireEgressApproval(env, c))) return null;
  const description =
    doc.name +
    " · " +
    egress
      .map((a) =>
        a.kind === "forward"
          ? a.mode + " to destination " + a.destination
          : a.kind.replaceAll("_", " "),
      )
      .join(", ");
  return propose(
    env,
    c,
    box,
    {
      kind: "rule",
      args: {
        id: edit.id ?? null,
        edit: { revision: edit.revision, scope: edit.scope, document: doc },
      },
      description,
    },
    edit.dry,
  );
}
type RuleContext = { credential?: Credential; reverses?: string; review?: string };
async function save(
  env: Bindings,
  p: Principal,
  box: string,
  id: string | undefined,
  input: Record<string, unknown>,
  context?: RuleContext,
) {
  const credential = context?.credential;
  const actor = human(p).id;
  const old = id ? await history(env, p, box, id) : null;
  await authorizePriorRule(env, p, box, old);
  const scope = editScope(old, input.scope, credential);
  const scopeId = await manageScope(env, p, box, scope);
  const revision = old?.revision || 0;
  if (revision !== input.revision)
    throw new Problem(409, "Rule has changed. Reload it before saving.");
  const doc = await editedDefinition(env, old, input);
  await validateForward(env, p, box, scope, doc);
  const proposal =
    credential &&
    (await checkRulePolicy(env, credential, box, doc, {
      review: context?.review,
      id,
      revision,
      scope,
      dry: input.dry_run === true,
    }));
  if (proposal) return proposal;
  if (input.dry_run === true) return recent(env, p, box, doc);
  return persistRule(
    env,
    box,
    {
      ruleId: id || context?.review || ulid(),
      actor,
      scope,
      scopeId,
      revision,
      doc,
      owner: old?.owner || actor,
    },
    context,
  );
}
async function persistRule(
  env: Bindings,
  box: string,
  edit: {
    ruleId: string;
    actor: string;
    scope: string;
    scopeId: string;
    revision: number;
    doc: Definition;
    owner: string;
  },
  context?: RuleContext,
) {
  const { ruleId, actor, scope, scopeId, revision, doc } = edit,
    credential = context?.credential;
  const audit = ulid();
  const insert =
    env.DB.prepare(`INSERT INTO rule_versions(rule_id,revision,scope,scope_id,owner,editor,document,at)
    SELECT ?,?,?,?,?,?,?,? FROM (SELECT ? AS owner,? AS scope,? AS scope_id) v WHERE ${authorized} AND (SELECT coalesce(max(revision),0) FROM rule_versions WHERE rule_id=?)=?
    AND (? > 0 OR (SELECT count(DISTINCT rule_id) FROM rule_versions WHERE scope=? AND scope_id=?)<24) ${credential ? "AND EXISTS(" + liveWrite + ")" : ""} ${context?.review ? "AND " + pendingReview : ""}`).bind(
      ruleId,
      revision + 1,
      scope,
      scopeId,
      edit.owner,
      actor,
      JSON.stringify(doc),
      new Date().toISOString(),
      actor,
      scope,
      scopeId,
      ruleId,
      revision,
      revision,
      scope,
      scopeId,
      ...(credential ? guard(credential, box) : []),
      ...(context?.review && credential ? [context.review, actor, credential.grant, box] : []),
    );
  const journal = ruleJournal(env, credential, box, ruleId, revision + 1, audit);
  const reverse = context?.reverses
    ? [
        env.DB.prepare(
          "UPDATE delegated_rules SET undone=1 WHERE audit_id=? AND rule_id=? AND revision=? AND changes()=1",
        ).bind(context.reverses, ruleId, revision),
      ]
    : [];
  const [row] = await env.DB.batch([
    insert,
    ...journal,
    ...reverse,
    ...finishReview(env, context?.review, audit),
  ]);
  if (!row.meta.changes)
    throw new Problem(409, "Rule changed or this scope reached its 24-rule limit");
  if (credential) await wakePush(env, audit);
  return { id: ruleId, revision: revision + 1, ...(credential ? { audit_id: audit } : {}) };
}
export async function ruleChange(
  env: Bindings,
  p: Principal,
  box: string,
  id: string | undefined,
  input: Record<string, unknown>,
  context?: RuleContext,
) {
  if (input.action !== "apply_existing") return save(env, p, box, id, input, context);
  if (!id) throw new Problem(400, "Save the rule before applying it");
  const v = await history(env, p, box, id);
  if (v.revision !== input.revision) throw new Problem(409, "Rule changed");
  const doc = definition(JSON.parse(v.document));
  if (!doc.enabled) throw new Problem(409, "Rule is disabled");
  if (doc.actions.some(isOutboundAction))
    throw new Problem(400, "Outbound rules apply to new arrivals only");
  const preview = await recent(env, p, box, doc);
  if (input.dry_run === true) return preview;
  for (const m of preview.matches) await env.DB.batch(ruleActions(env, box, m.id, v, doc.actions));
  await changed(env, box);
  return preview;
}
