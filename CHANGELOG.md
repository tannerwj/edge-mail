# Edge Mail changelog

## 0.2.3 · First mailbox setup

The Deploy wizard describes each storage and queue binding. Domain import explains how to refresh a new installation by Worker name. Owners can create a mailbox directly on its domain setup page and preview routing for one selected address.

## 0.2.2 · Mailbox navigation and unread counts

Owners and domain admins can open mailbox setup directly from an empty workspace. An unavailable mailbox bookmark offers a way back to accessible inboxes. Shared readers see their access level, empty searches offer a way back to mail, and unread counts update after individual and bulk changes.

## 0.2.1 · Feedback review

The private feedback preview explains who can read a report. The maintainer’s authorized coding agents can read submitted reports to investigate fixes. Existing installations can use the same feedback channel without a migration.

## 0.2.0 · Private project feedback

Downstream users can send reviewed reports from the inbox and check for a maintainer reply on the same device. No mailbox migration is required.

## 0.1.0 · Public preview

### Schema 0035 and compose

Discarded drafts can be restored for 15 seconds. Undo send restores an editable draft with its attachments before delivery begins. The composer supports editable recipient chips, pasted screenshots and forgotten attachment reminders. Apply migration 0035 before upgrading.

### Mail and recovery

- Receive mail by primary address, alias and plus address. Each delivery retains its original SMTP envelope and raw MIME. Repeated deliveries of the same content to a mailbox share an inbox entry.
- Search and organize mail, reply or forward, autosave private drafts, undo or schedule a send and inspect per-recipient delivery outcomes. The reader supports isolated formatted mail, signed attachment downloads and optional offline text.
- Release checks exercise browser journeys and mail delivery. Nightly snapshots include mailbox metadata, search inputs, private Sent envelopes and the wrapped content-signing key. A restore starts with users disabled and pending sends held.

### Upgrade through schema 0034

Mailbox owners can inspect receipt rates and storage use. Instance owners can set sender and recipient limits and mailbox storage budgets. Accepted mail stays available when a limit stops new receipts. The receiving-domain wizard creates standard role mailboxes and can request forwarding destination verification. Participating senders can review invitation replies in a draft. Operators can publish an MTA-STS policy and TLS reporting address per domain.

### Upgrade through schema 0033

Schemas 24–32 add reminders, delegated spending limits, templates and contacts, expiring addresses, operating budgets, DMARC reports, signed reply-through, optional mailbox assistance and private saved searches. Existing bookmarks open on the corresponding mailbox paths. The unified and domain inboxes honor mailbox membership.

Schema 33 adds owner-confirmed person erasure. The owner reviews exclusive mailboxes before confirming. Shared correspondence stays available. Cleanup removes private drafts, sign-ins and credentials, and records a receipt that also applies when restoring an older backup. Storage locks can defer physical deletion. Keep the erasure-aware recovery tools with your backups.

### Upgrade through schema 0023

Apply migrations before promoting the Worker. Schemas 14–20 add agent grants, sender screening, OAuth, delegated work, uploads, encrypted notifications and identity-specific signatures. Schema 21 adds durable deletion receipts and timed Trash and Spam cleanup. Schema 22 adds per-reader image preferences. Schema 23 adds signed mailbox webhooks, scoped delivery history and key rotation. Existing mailboxes begin with remote images hidden and zero registered webhooks.

Use an erasure-aware version to restore past an issued deletion. Recovery leaves users disabled, agent grants revoked, pending sends stopped and webhook subscriptions disabled. Restore the saved wrapping secret before enabling any encrypted capability.

### Upgrade to schema 0013

Apply forwarding destination and attempt tables, indexes and offboarding triggers before deploying. The outbox checks that the sender, destination and rule version still allow each queued resend before submission. Keep the forward attempt records across Worker rollbacks so lost acknowledgements retain their history.

### Upgrade to schema 0012

Apply the additive rule version and run-log tables before deploying. Incoming mail evaluates the active instance, domain and mailbox rules, in that order. Reverting the Worker suspends future rule evaluation. Existing message organization persists. Historical snapshots keep the inventory for their original schema.

### Upgrade to schema 0011

Apply the additive offboarding receipt migration before deploying the Worker. Every recorded offboarding uses one D1 transaction. Preserve the database when rolling back code so disabled people stay disabled. An older Worker can continue serving mail, but its snapshot inventory requires the matching schema before it can start another snapshot. Prior snapshots remain readable.

### Upgrade to schema 0010

1. Save the current Worker version and D1 Time Travel bookmark. Verify that your stored setup secret is available for recovery of the content-signing key.
2. Preview the release and apply all outstanding migrations before deploying the Worker. Schema 0010 indexes provider IDs and fills in eligible historical Cloudflare Sent Message-IDs. Opaque capture IDs remain synthetic.
3. Send a fixture to an owned mailbox. Compare the outbound provider ID, Sent Message-ID and Message-ID on the received raw message. Check that a reply from a visible recipient joins the Sent conversation.
4. For a code rollback, restore the preceding Worker version. Its schema is compatible with the added index and recovered IDs. A D1 rewind can discard subsequent mail and user edits. Preserve and reconcile retained receipts if a data rewind becomes necessary.

A snapshot taken with schema 0007, 0008 or 0009 can still be read by the restore tool. Restore into isolated storage and check membership, search results and private Sent envelopes before making recovered mail accessible.
