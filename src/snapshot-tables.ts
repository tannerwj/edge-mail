// Keep this inventory and the copy-on-write triggers in the same migration. Restore in dependency order.
const first = [
  "users",
  "user_emails",
  "domains",
  "domain_admins",
  "mailboxes",
  "mailbox_members",
  "addresses",
  "messages",
  "deliveries",
  "ingest_failures",
  "reconciliation",
  "provider_probes",
  "message_labels",
  "message_metadata",
  "thread_members",
  "drafts",
  "reply_headers",
  "outbox",
  "outbox_control",
] as const;

const withKeys = [...first, "instance_keys"] as const;
const withEvents = [...withKeys, "delivery_events"] as const;
const withPeople = [...withEvents, "offboard_receipts"] as const;
const withRules = [...withPeople, "rule_versions", "rule_runs"] as const;
const withForwarding = [...withRules, "egress_destinations", "forward_attempts"] as const;
const withAgents = [
  ...withForwarding,
  "agent_grants",
  "agent_tokens",
  "agent_audit",
  "triage_undo",
  "agent_code_usage",
] as const;
export const migration = "0035_discarded_drafts.sql";
const withScreening = [
  ...withAgents,
  "mailbox_screening",
  "sender_list",
  "mail_assessment",
  "spam_samples",
  "vacation_replies",
] as const;
const withDelegation = [...withScreening, "agent_requests", "delegated_rules"] as const;
const withNotices = [...withDelegation, "egress_alerts"] as const;
const withSignatures = [...withNotices, "identity_signatures"] as const;
const withImages = [...withSignatures, "sender_images"] as const;
const withHooks = [...withImages, "webhooks"] as const;
const withTimers = [...withHooks, "thread_state", "message_wakes", "timer_undo"] as const;
const withLimits = [...withTimers, "grant_policies", "grant_spend", "agent_reviews"] as const;
const withLibrary = [...withLimits, "contacts", "compose_templates"] as const;
const withAddresses = [
  ...withLibrary,
  "temporary_addresses",
  "receipt_preferences",
  "unknown_recipient_policy",
] as const;
const withBudgets = [
  ...withAddresses,
  "instance_policy",
  "user_limits",
  "send_reservations",
  "ops_alerts",
] as const;
const withReports = [...withBudgets, "dmarc_mailboxes", "dmarc_reports"] as const;
const withAi = [...withReports, "mailbox_ai"] as const;
const withSearches = [...withAi, "saved_searches"] as const;
export const tables = [...withSearches, "mailbox_quotas"] as const;
const inventories: Record<string, readonly (typeof tables)[number][]> = {
  "0007_snapshots.sql": first,
  "0008_instance_keys.sql": withKeys,
  "0009_delivery_events.sql": withEvents,
  "0010_sent_ids.sql": withEvents,
  "0011_offboarding.sql": withPeople,
  "0012_rules.sql": withRules,
  "0013_forwarding.sql": withForwarding,
  "0014_agent_grants.sql": withAgents,
  "0015_screening.sql": withScreening,
  "0016_oauth.sql": withScreening,
  "0017_delegated_work.sql": withDelegation,
  "0018_agent_uploads.sql": withDelegation,
  "0019_notifications.sql": withNotices,
  "0020_identity_signatures.sql": withSignatures,
  "0021_erasure.sql": withSignatures,
  "0022_sender_images.sql": withImages,
  "0023_webhooks.sql": withHooks,
  "0024_thread_reminders.sql": withTimers,
  "0025_agent_limits.sql": withLimits,
  "0026_composer_library.sql": withLibrary,
  "0027_disposable_addresses.sql": withAddresses,
  "0028_operating_limits.sql": withBudgets,
  "0029_aggregate_reports.sql": withReports,
  "0030_reply_through.sql": withReports,
  "0031_mailbox_ai.sql": withAi,
  "0032_saved_searches.sql": withSearches,
  "0033_person_erasure.sql": withSearches,
  "0034_inbound_quotas.sql": tables,
  [migration]: tables,
};
export function snapshotTables(version: string) {
  const inventory = Object.hasOwn(inventories, version) ? inventories[version] : undefined;
  if (!inventory) throw Error("Unknown snapshot schema");
  return inventory;
}

// Derived classifier frequencies and short-lived login material are rebuilt or revoked on recovery.
export const ephemeralTables = new Set([
  "quota_usage",
  "quota_reservations",
  "person_erasures",
  "person_boxes",
  "person_cleanup",
  "account_usage",
  "apex_route_ownership",
  "webhook_jobs",
  "erase_scan",
  "erasures",
  "erased_objects",
  "trash_retention",
  "push_devices",
  "push_jobs",
  "agent_uploads",
  "change_stream",
  "changes",
  "spam_counts",
  "oauth_credentials",
  "oauth_pending",
  "oauth_registrations",
]);
