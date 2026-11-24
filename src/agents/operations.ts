import { directory } from "./directory";
import { addDestination } from "./destinations";
import { destinations } from "../ops/destinations";
import { addressSettings, disposable } from "../ops/disposable";
import { writesOn, operatingLimits } from "../ops/budgets";
import { operations } from "../ops/operations";
import { suppressionList } from "../ops/suppressions";
import { library, saveLibrary } from "../ops/composer-library";
import { listHooks, changeHook } from "../ops/webhooks";
import { mailboxIdentities } from "../ops/identities";
import { createUpload } from "./uploads";
import { threadGet, threadAction } from "./thread-ops";
import { changesSince, waitMessage } from "./changes";
import { address } from "../address";
import { catalog } from "./catalog";
import { writeMail, agentRule } from "./mail-ops";
import { outbox } from "../ops/outbox";
import { explain } from "../ops/message-explain";
import type { Bindings } from "../env";
import { Problem, requireValue } from "../env";
import { inbox, readMessage } from "../ops/inbox";
import { workspace } from "../ops/mailboxes";
import { attachments } from "../ops/attachments";
import { triage } from "../ops/triage";
import { listRules } from "../ops/rule-definitions";
import { mailboxAccess } from "../ops/access";
import { auditList } from "./audit";
import { undoAction } from "./activity";
import { permits, issueToken, recheckCredential, type Credential } from "./grants";
function webhookOperation(
  env: Bindings,
  c: Credential,
  box: string,
  name: string,
  args: Record<string, unknown>,
  dry: boolean,
) {
  return name === "webhook_list"
    ? listHooks(env, c.user, box)
    : changeHook(env, { user: c.user, credential: c }, box, name.slice(8), args, dry);
}
async function scopedBox(env: Bindings, c: Credential, raw: unknown) {
  const box = requireValue(raw, 26);
  if (c.boxes && !c.boxes.includes(box)) throw new Problem(403, "Mailbox outside grant");
  if (
    !(await env.DB.prepare("SELECT b.id " + mailboxAccess + " AND b.id=?")
      .bind(c.user.id, box)
      .first())
  )
    throw new Problem(404, "Mailbox unavailable");
  return box;
}
async function messagePage(
  env: Bindings,
  c: Credential,
  box: string,
  args: Record<string, unknown>,
) {
  const offset = args.offset ?? 0;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)
    throw new Problem(400, "Invalid body offset");
  const m = await readMessage(env, c.user, box, requireValue(args.id, 26));
  return {
    ...m,
    body: m.body.slice(offset, offset + 32768),
    next_offset: offset + 32768 < m.body.length ? offset + 32768 : null,
  };
}
function threadSearch(env: Bindings, c: Credential, box: string, args: Record<string, unknown>) {
  return inbox(
    env,
    c.user,
    box,
    new URLSearchParams({
      group: "thread",
      q: typeof args.q === "string" ? args.q : "",
      ...(typeof args.cursor === "string" ? { cursor: args.cursor } : {}),
    }),
  );
}
function part(value: unknown) {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    throw new Problem(400, "Invalid attachment index");
  return String(value);
}
export async function executeOperation(
  env: Bindings,
  original: Credential,
  name: string,
  args: Record<string, unknown>,
  dry = false,
) {
  const c = await recheckCredential(env, original);
  const op = await authorizeOperation(env, c, name);
  if (name === "changes_since")
    return changesSince(env, c, args.mailbox ? await scopedBox(env, c, args.mailbox) : null, args);
  if (name === "message_wait") {
    const rawBox =
      args.mailbox ??
      (await env.DB.prepare("SELECT mailbox_id FROM addresses WHERE canonical=?")
        .bind(address(args.address).canonical)
        .first<string>("mailbox_id"));
    return waitMessage(env, c, await scopedBox(env, c, rawBox), args);
  }
  const box = op.mailbox ? await scopedBox(env, c, args.mailbox) : "";
  const preview = dry || args.dry_run === true;
  if (name.startsWith("webhook_")) return webhookOperation(env, c, box, name, args, preview);
  if (name === "upload_create") return createUpload(env, c, box, args, preview);
  if (name === "thread_get") return threadGet(env, box, args);
  if (name.startsWith("thread_") && op.write) return threadAction(env, c, box, name, args, preview);
  if (name.startsWith("mail_") || name.startsWith("draft_"))
    return writeMail(env, c, box, name, args, preview);
  if (name.startsWith("rule_") && name !== "rule_list")
    return agentRule(env, c, box, name, args, preview);
  if (name === "outbox_get") return outbox(env, c.user, box, requireValue(args.id, 26));
  return otherOperation(env, c, box, name, args, preview);
}
function otherOperation(
  env: Bindings,
  c: Credential,
  box: string,
  name: string,
  args: Record<string, unknown>,
  preview: boolean,
) {
  if (name === "egress_destination_list") return destinations(env, c.user, box);
  if (name === "egress_destination_add") return addDestination(env, c, box, args.address, preview);
  if (/^(user_|domain_|settings_|grant_|token_(?:list|revoke)$|mailbox_create$)/.test(name))
    return directory(env, c, name, args, preview);
  if (name === "address_list_disposable") return addressSettings(env, c.user, box);
  if (name.startsWith("address_"))
    return disposable(
      env,
      c.user,
      box,
      { ...args, action: name === "address_create_disposable" ? "create" : "disable" },
      c,
      preview,
    );
  if (name.startsWith("contact_") || name.startsWith("template_")) {
    if (name.endsWith("_list"))
      return library(
        env,
        c.user,
        box,
        typeof args.q === "string" ? args.q : "",
        name === "contact_list" ? "contacts" : "templates",
      );
    return saveLibrary(env, c.user, box, { ...args, action: name }, c, preview);
  }
  return basicOperation(env, c, box, name, args, preview);
}
async function agentIdentities(env: Bindings, c: Credential, box: string) {
  const known = (
    await env.DB.prepare(
      "SELECT address,kind FROM addresses WHERE mailbox_id=? ORDER BY kind DESC,address",
    )
      .bind(box)
      .all<{ address: string; kind: string }>()
  ).results;
  const allowed = await mailboxIdentities(env, c.user, box);
  const result = known.map((a) => ({
    ...a,
    can_send: allowed.some((i) => i.from === a.address.toLowerCase()),
  }));
  for (const i of allowed)
    if (!result.some((a) => a.address.toLowerCase() === i.from))
      result.push({ address: i.from, kind: "sender", can_send: true });
  return result;
}
async function basicOperation(
  env: Bindings,
  c: Credential,
  box: string,
  name: string,
  args: Record<string, unknown>,
  dry: boolean,
) {
  if (["send_quota_get", "metrics_summary", "suppression_list"].includes(name))
    return telemetry(env, c, name, args);
  switch (name) {
    case "label_list":
      return (
        await env.DB.prepare(
          "SELECT label,count(*) count FROM message_labels WHERE mailbox_id=? GROUP BY label ORDER BY label LIMIT 300",
        )
          .bind(box)
          .all()
      ).results;
    case "identity_list":
      return agentIdentities(env, c, box);
    case "whoami":
      return { user: c.user, grant: c.grant, scopes: c.scopes, boxes: c.boxes, expires: c.expires };
    case "mailbox_list":
      return (await workspace(env, c.user)).mailboxes.filter(
        (b) => !c.boxes || c.boxes.includes(b.id),
      );
    case "message_explain":
      return explain(env, c.user, box, requireValue(args.id, 26));
    case "message_get":
      return messagePage(env, c, box, args);
    case "thread_search":
      return threadSearch(env, c, box, args);
    case "attachment_get":
      return attachments(env, c.user.id, box, requireValue(args.id, 26), part(args.part), c);
    case "rule_list":
      return listRules(env, c.user, box);
    case "message_triage":
      return triage(
        env,
        c.user,
        box,
        args.ids,
        { ...args, dry_run: dry || args.dry_run === true },
        c,
      );
    case "audit_list":
      return auditList(env, c, box);
    case "audit_undo":
      return undoAction(
        env,
        { user: c.user, credential: c },
        box,
        requireValue(args.id, 26),
        dry || args.dry_run === true,
      );
    case "token_create": {
      if (dry || args.dry_run === true) return { would_create: true };
      return issueToken(env, c.user, c.audience, args, c);
    }
    default:
      throw new Problem(404, "Unknown operation");
  }
}

function telemetry(env: Bindings, c: Credential, name: string, args: Record<string, unknown>) {
  if (c.boxes !== null) throw new Problem(403, "An instance-wide administrator grant is required");
  if (name === "metrics_summary") return operations(env, c.user);
  if (name === "send_quota_get") return operatingLimits(env, c.user);
  const url = new URL(c.audience);
  for (const key of ["domain", "cursor"])
    if (typeof args[key] === "string") url.searchParams.set(key, args[key]);
  return suppressionList(env, c.user, url);
}

async function authorizeOperation(env: Bindings, c: Credential, name: string) {
  const op = catalog.find((e) => e.name === name);
  if (!op) throw new Problem(404, "Unknown operation");
  if (op.write && !(await env.DB.prepare("SELECT 1 WHERE " + writesOn).first()))
    throw new Problem(403, "Agent writes are paused");
  if (!permits(c.scopes, op.scope)) throw new Problem(403, "insufficient_scope");
  return op;
}
