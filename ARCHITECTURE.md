# Edge Mail architecture

Edge Mail runs a separate Cloudflare Worker, database, bucket and queues in each environment. The app hostname serves the reader and authenticated API. A sibling content hostname serves formatted mail and attachments. Staging also has a narrowly scoped verification identity and capture sender. Production uses a configured Email Sending identity.

## Inbound mail

1. Email Routing hands the envelope and the MIME stream to the Worker. The recipient lookup resolves the exact address or its plus-address base. The Worker rejects an unknown recipient under the deployed policy.
2. A successful R2 write is the receipt boundary. The object contains the original MIME plus metadata for that individual envelope, including Bcc deliveries. A failed queue handoff after this write leaves enough information for recovery.
3. The ingest consumer parses the saved bytes, stores the readable body, and commits the mailbox message, envelope, search data and conversation membership. Mailbox-scoped deduplication lets multiple deliveries point to one message.
4. A scheduled reconciler pages through raw objects and queues receipts missing from the index. Reprocessing an indexed receipt is safe. Successful changes notify the mailbox's Durable Object so connected readers can refresh.

## Reading and sending

Cloudflare Access establishes identity. The Worker verifies the signed assertion and checks the current Edge Mail user, mailbox and operation. The mailbox owns shared flags, folders and labels. Drafts and the outbound envelope belong to their author. Bcc stays out of shared Sent headers and delivery-status counts.

The formatted reader and downloads use five-minute bearer links. Each link binds the issuer, content host, mailbox, message and permitted use. The content Worker checks current access again when serving it. It sanitizes HTML, blocks remote media, and serves the reader inside a sandboxed iframe. A user can read plain text on the app origin. Offline access uses the user's explicit selection and retains a bounded text copy on that device.

Submitting a draft fixes the recipient list and creates an outbox item keyed by the draft ID. A Durable Object alarm wakes at the undo deadline or scheduled send time. A database sweep also picks up due items. The claim checks current authorization and reserves the daily recipient budget before provider submission. A lost acknowledgement leaves an uncertain item. The sender's private envelope and the shareable Sent message have separate representations.

The sending domain publishes delivery events to a dedicated queue. D1 retains events by provider event ID. Sent views match the configured domain and provider message ID, then summarize visible recipients. An event may arrive before the sender records acceptance.

## Storage and recovery

| Resource | Responsibility |
| --- | --- |
| D1 | Users, domains, addresses, mailbox grants, message and thread indexes, shared state, drafts, outbox, provider events, recovery progress and wrapped signing keys. |
| R2 | Raw messages and envelope metadata, readable bodies, derived attachments and HTML, Sent MIME and private envelopes, and snapshot manifests and parts. |
| Queues | Independent delivery of ingest jobs and provider events, with dead-letter queues. |
| Durable Objects | Per-submission alarms and per-mailbox WebSockets. Each connection is checked against current grants before receiving an invalidation. |

Each daily snapshot records a D1 bookmark, consistent row pages and an R2 inventory. Copy-on-write triggers preserve row versions while the pages are built. Restore writes into separate resources, validates snapshot parts, rebuilds search, disables restored users and holds outstanding dispatch. See [the operational runbook](DEPLOY.md) and [the verification procedures](TESTING.md).

## Delegated access and notifications

OAuth clients and API tokens resolve to a user, mailbox selection and grant chain. The MCP server and REST share an operation catalog. A Dynamic Worker executes an agent program with network access disabled and a scoped operation binding. Revocation takes effect on subsequent calls and on the dispatch of delegated sends, rules and webhook events. Audit entries identify the grant and affected mailbox.

Webhook subscriptions store the receiver URL and signing key encrypted under the instance wrapping key. Mailbox events enqueue stable delivery IDs in the same D1 transaction as the event. The scheduler leases due rows, signs the payload and makes a bounded HTTPS request. Mailbox ownership and current grant permissions are checked again at delivery. A failed acknowledgement can cause a retry with the same delivery ID. The isolated restore disables subscriptions before opening the recovered instance.

The image proxy uses a separate content host. The reader requests each remote image through a short-lived, message-scoped link after consent. The fetcher validates public DNS on every redirect, limits response size, and verifies raster signatures. Browser subscriptions and remote-image preferences belong to the individual reader. Automatic images require a saved preference and a passing sender DMARC verdict.

## Browser interfaces

TanStack Router owns deep links, Query caches mailbox data and Virtual windows large conversation lists. A keyboard-accessible separator remembers the list width. Tiptap loads when a writer chooses a formatted message. It edits the same text representation as saved drafts and templates and uses the mail formatter for its inline marks. Settings loads on demand. Tailwind CSS v4 produces static utilities, and Lucide provides toolbar and mailbox icons.

The command palette uses a native dialog and an accessible combobox. The resize control, swipe gestures, action notices and form controls use browser APIs and application CSS. These cover the interactions assigned to cmdk, react-resizable-panels, Motion, Sonner and shadcn/Base UI in the draft spec. The cmdk build measured 289.8 KiB across compressed client scripts against the existing 280 KiB budget.
