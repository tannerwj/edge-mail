import type { ErasureStore, PersonRecord } from "./person-storage";
import { eraseStored } from "./ops/erasure";
const required = "SELECT box FROM person_boxes WHERE target=?";
export async function preparePerson(env: ErasureStore, r: PersonRecord) {
  const db = env.DB;
  const actor = (s: string) => db.prepare(s).bind(r.target);
  const statements = [
    // Collect private object prefixes before discarding references in any mailbox.
    db
      .prepare(
        "INSERT OR IGNORE INTO person_cleanup(target,path,prefix) SELECT ?, 'att/uploads/'||mailbox_id||'/'||id||'/',1 FROM drafts WHERE actor=? UNION SELECT ?, 'temporary/uploads/'||id,0 FROM agent_uploads WHERE actor=? UNION SELECT ?, 'att/uploads/'||mailbox_id||'/'||id||'/',1 FROM outbox WHERE actor=? AND state!='sent'",
      )
      .bind(r.target, r.target, r.target, r.target, r.target, r.target),
    db
      .prepare(
        "INSERT OR IGNORE INTO person_cleanup(target,path,prefix) SELECT ?,p.value||'/'||b.box||'/',1 FROM person_boxes b,json_each(?) p WHERE b.target=?",
      )
      .bind(
        r.target,
        JSON.stringify(["raw", "sent", "body", "att", "html", "att/uploads"]),
        r.target,
      ),
    db
      .prepare(
        "INSERT INTO mailbox_members(mailbox_id,user_id,role) SELECT m.mailbox_id,a.id,'owner' FROM mailbox_members m JOIN users a ON a.id=(SELECT id FROM users WHERE role='owner' AND id!=? ORDER BY (id=?) DESC,id LIMIT 1) WHERE m.user_id=? AND m.role='owner' AND m.mailbox_id NOT IN (" +
          required +
          ") AND NOT EXISTS(SELECT 1 FROM mailbox_members x JOIN users u ON u.id=x.user_id WHERE x.mailbox_id=m.mailbox_id AND x.user_id!=m.user_id AND x.role='owner' AND u.disabled_at IS NULL) ON CONFLICT(mailbox_id,user_id) DO UPDATE SET role='owner'",
      )
      .bind(r.target, r.actor, r.target, r.target),
    actor("DELETE FROM webhook_jobs WHERE hook IN (SELECT id FROM webhooks WHERE actor=?)"),
    actor("DELETE FROM webhooks WHERE actor=?"),
    actor(
      "UPDATE egress_destinations SET address=id||'@erased.invalid',disabled=1,verified_at=NULL WHERE owner=?",
    ),
    actor(
      "UPDATE rule_runs SET actions='[]' WHERE EXISTS(SELECT 1 FROM rule_versions v WHERE v.owner=? AND v.rule_id=rule_runs.rule_id AND v.revision=rule_runs.revision)",
    ),
    db
      .prepare("UPDATE rule_versions SET document=? WHERE owner=?")
      .bind(
        JSON.stringify({
          name: "Erased rule",
          enabled: false,
          order: 0,
          stop: false,
          condition: { field: "subject", op: "equals", value: "erased" },
          actions: [{ kind: "mark_read" }],
        }),
        r.target,
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO person_cleanup(target,path,prefix) SELECT ?, 'temporary/uploads/'||id,0 FROM agent_uploads WHERE mailbox_id IN (" +
          required +
          ")",
      )
      .bind(r.target, r.target),
    actor(
      "UPDATE users SET role='member',disabled_at=COALESCE(disabled_at,CURRENT_TIMESTAMP) WHERE id=?",
    ),
    actor(
      "UPDATE agent_grants SET name='Erased account',revoked=coalesce(revoked,unixepoch()*1000) WHERE actor=?",
    ),
    actor(
      "UPDATE agent_reviews SET state='declined',request=NULL,reason='Account erased' WHERE actor=?",
    ),
    actor(
      "UPDATE outbox SET state='cancelled',letter='{}',from_addr='',reply_addr='',parent=NULL WHERE actor=? AND state NOT IN ('sent','claimed','uncertain')",
    ),
    actor("DELETE FROM push_jobs WHERE device IN (SELECT id FROM push_devices WHERE actor=?)"),
    actor(
      "DELETE FROM grant_policies WHERE grant_id IN (SELECT id FROM agent_grants WHERE actor=?)",
    ),
    actor("DELETE FROM agent_tokens WHERE grant_id IN (SELECT id FROM agent_grants WHERE actor=?)"),
    actor(
      "DELETE FROM oauth_credentials WHERE grant_id IN (SELECT id FROM agent_grants WHERE actor=?)",
    ),
    ...[
      "drafts",
      "compose_templates",
      "agent_uploads",
      "user_limits",
      "oauth_pending",
      "push_devices",
      "saved_searches",
    ].map((t) => actor("DELETE FROM " + t + " WHERE actor=?")),
    ...["user_emails", "domain_admins", "mailbox_members", "sender_images"].map((t) =>
      actor("DELETE FROM " + t + " WHERE user_id=?"),
    ),
    actor("DELETE FROM addresses WHERE mailbox_id IN (" + required + ")"),
    actor(
      "UPDATE temporary_addresses SET disabled=1,reason='erased' WHERE mailbox_id IN (" +
        required +
        ")",
    ),
    actor(
      "UPDATE unknown_recipient_policy SET mode='reject',mailbox_id=NULL WHERE mailbox_id IN (" +
        required +
        ")",
    ),
    actor("UPDATE person_erasures SET prepared=1 WHERE target=?"),
  ];
  await db.batch(statements);
}
async function removeBox(env: ErasureStore, box: string) {
  const db = env.DB,
    byBox = (s: string) => db.prepare(s).bind(box);
  const tables = [
    "push_jobs",
    "webhooks",
    "egress_alerts",
    "agent_reviews",
    "agent_requests",
    "drafts",
    "outbox",
    "forward_attempts",
    "egress_destinations",
    "delegated_rules",
    "identity_signatures",
    "sender_images",
    "mailbox_screening",
    "receipt_preferences",
    "temporary_addresses",
    "contacts",
    "compose_templates",
    "mailbox_ai",
    "saved_searches",
    "dmarc_mailboxes",
    "mailbox_members",
    "addresses",
    "agent_uploads",
    "thread_state",
    "message_wakes",
    "unknown_recipient_policy",
  ];
  await db.batch([
    byBox("DELETE FROM webhook_jobs WHERE hook IN (SELECT id FROM webhooks WHERE mailbox_id=?)"),
    byBox("UPDATE agent_audit SET mailbox_id=NULL WHERE mailbox_id=?"),
    ...tables.map((t) => byBox("DELETE FROM " + t + " WHERE mailbox_id=?")),
    byBox("DELETE FROM rule_versions WHERE scope='mailbox' AND scope_id=?"),
    byBox("DELETE FROM sender_list WHERE scope_id=?"),
    byBox("DELETE FROM mailboxes WHERE id=?"),
    byBox("UPDATE person_boxes SET closed=1 WHERE box=?"),
  ]);
}
export async function purgeOneBox(env: ErasureStore, target: string) {
  const box = await env.DB.prepare(
    "SELECT box FROM person_boxes WHERE target=? AND closed=0 ORDER BY box LIMIT 1",
  )
    .bind(target)
    .first<string>("box");
  if (!box) return false;
  const messages = await env.DB.prepare(
    "SELECT id FROM messages WHERE mailbox_id=? ORDER BY id LIMIT 4",
  )
    .bind(box)
    .all<{ id: string }>();
  if (messages.results.length) {
    for (const m of messages.results) await eraseStored(env, box, m.id);
  } else await removeBox(env, box);
  return true;
}
