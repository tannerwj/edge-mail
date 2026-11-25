# Mailbox guide

## Forwarding mail

Open **Settings → Mail handling → Mail rules** and choose the mailbox. Mailbox owners can add a forwarding destination. Run `pnpm destination:verify --check WORKER ID` to preview verification, then use `--apply` to ask Cloudflare to send its confirmation email. After the recipient follows the link, repeat the apply command and refresh verification in Settings.

Create a rule, choose **Forward**, and select a verified address. Relay keeps the original sender and requires header-only conditions. Queued resend uses the mailbox sender and includes the complete original as a downloadable attachment. Both require trusted DMARC authentication, skip lists and automatic mail, reject local destinations and stop returned loop-marked messages. The per-mailbox limit is 20 forwards per envelope sender per hour. Staging captures configured sends. Disable the rule or destination to stop future work. A submitted message may already be on its way.

### Enable sending during installation

Add `--sender receipts@dispatch.example.com --sending-mailbox support@example.com` to both the preview and apply commands. Choose a dedicated sending subdomain under an active Cloudflare zone. The preview lists the provider's proposed bounce MX, SPF, DKIM and DMARC records. Apply onboards that subdomain, binds the exact From address, and subscribes the instance's delivery queue to that subdomain's events. The reply mailbox must be created in Settings and connected for inbound delivery. Later upgrades read the sender from the deployed Worker. To install an inbox for receiving only, omit both flags on the first install.

Sending consumes the account's Email Sending quota. The event and dead-letter queues may incur Queue operations. To roll back an upgrade, restore the printed Worker version. Cloudflare retains the sender and its DNS records. Retire those through Email Sending once all clients using the sender have been disconnected.

### Move mail between providers

A mailbox owner can open **Settings → Mail data → Import and export mail**, choose the destination and select an mbox file from the previous application. Leave the tab open during import. Retrying the same file resumes safely. Messages keep their original dates and MIME attachments. Historical imports skip delivery rules. Use **Export mbox** for another mail client or **Export originals, labels and rules** for a ZIP containing individual EML files and JSON metadata. Archives contain private mail. Choose a local destination you control.

### Device notifications

Open **Settings → Preferences → Device notifications** on each device. Choose security changes alone or include mail arrivals and grant the browser permission. On iPhone, install the app on the Home Screen first. Edge Mail generates the VAPID identity on first use, encrypts the private key and device subscription in D1, and omits senders and subjects from notification text. Restored instances require a fresh subscription. An owner can undo or acknowledge a connected agent’s automatic delivery rule directly from the mailbox banner.

### Add another From address

Repeat `--identity orders@dispatch.example.com=support@example.com` on the guided CLI installer to authorize an additional From address for one reply mailbox. Supply the same options to preview and apply. An upgrade keeps existing identities. Remove one with `--remove-identity orders@dispatch.example.com`. Every sending subdomain receives its own DNS check and event subscription. The Worker binding allows only the configured senders. An owner can write a signature for each address in Settings. A writer chooses the From address and whether to include its signature in Compose.

### Connect a webhook receiver

In **Settings → Agents & integrations → Webhooks**, select a mailbox, enter a public HTTPS endpoint and choose the events your application needs. Copy the signing key directly to the receiver's secret store. The delivery log shows retries. **Disable webhook** cancels outstanding deliveries. Agent registrations appear in the mailbox owner's activity feed.

Verify the hexadecimal HMAC-SHA256 signature using the displayed key as UTF-8 text. Sign the timestamp, a period, the delivery ID, another period and the exact request body. Read the values from `Edge-Mail-Timestamp`, `Edge-Mail-Delivery`, `Edge-Mail-Key-Version` and `Edge-Mail-Signature` (which starts with `sha256=`). Reject stale timestamps, compare signatures in constant time, and deduplicate successful deliveries by ID. Return a 2xx response after accepting the event. Key rotation gives outstanding deliveries one hour to use the previous key. A failed delivery gets up to eight attempts. The payload identifies the mailbox and resource. Use a separately authorized read credential when the receiver needs message content.

### Invite another person

Open **Settings → People & access → People and invitations**, enter their Cloudflare Access sign-in email, and select their instance role. Choose a shared mailbox and a mailbox role. If the mailbox can send, you can queue an invitation from that mailbox. A second sign-in email can point to the same person. Disabling the person covers all their sign-in addresses.

For an installation using the guided CLI's exact-email Access policy, run `pnpm access:member --check WORKER person@example.com`, then repeat with `--apply`. The helper checks the installation record, active account, local user and existing policy. Use `--remove` with the same commands to remove one sign-in address at the Access gate. If your organization manages access through an identity-provider group or custom policies, maintain membership there. The mailbox link in an invitation always requires sign-in.

For a dedicated apex, preview `pnpm domain:connect --check example.com worker-name --catch-all`, then use `--apply`. Unknown recipients are rejected until you choose a policy in Settings. Every new disposable address on that apex can then receive immediately. The installer records the original rule before changing it. To roll back, run the same preview and apply with `--disconnect --catch-all`. Shared zones and subdomains can use `--only address@example.com` to provision one exact route.

In **Settings → Delivery & operations → Delivery budgets and alerts**, owners control monthly instance and daily user limits, pause agent writes or all outbound mail, and acknowledge delivery alerts. To display hourly provider totals, add an optional account-scoped Analytics Read Worker secret named `ACCOUNT_ANALYTICS_TOKEN`. For **Suppressed recipients**, add the optional Worker secret `SUPPRESSION_API_TOKEN` with Email Sending Edit for this account. The app lists the selected sending domain and asks for confirmation before removing a mutable suppression. The local sending limits operate with either integration disconnected.

To collect DMARC aggregate reports, open **Settings → Delivery & operations → DMARC aggregate reports**, select a mailbox for the policy domain and start collection. Publish its address as the `rua=mailto:` destination in the domain’s DMARC record. The dashboard shows authenticated reporting domains, alignment totals and dispositions, with links to the received originals. It handles XML and bounded gzip or ZIP attachments. Stopping collection preserves the reports already received.

For queued resends, the rule owner can enable **Allow one reply through the mailbox**. The verified destination can send one authenticated text reply to the original author within seven days. Connect a catch-all on the dedicated receiving domain or ensure the provider routes plus tags to the Worker. Disabling the destination or replacing the rule also cancels outstanding reply permissions.

## Optional mailbox assistance

Add `--ai` to the installer preview and apply to bind Workers AI. Mailboxes start with assistance off. A mailbox owner can expand **Mailbox assistance** and allow it for that mailbox. Each explicit request shares the search description or excerpts from up to five messages in the selected thread with Cloudflare. The model generates up to 350 tokens per request. Each mailbox can use 30 requests per UTC day. Failed provider attempts count toward this limit. Applying a suggestion requires a separate action. Turn off the mailbox setting or upgrade with `--disable-ai` to remove the binding.

## Working through mail

Use **All inboxes** or expand **By domain** to read and search across mailboxes. Use Filters to narrow by sender, recipient, date or attachment. Compose lets you change the sending mailbox while keeping your unsent text and files. Replies use the mailbox that received them. Archive and bulk triage offer Undo. In Preferences you can enable mark-on-open for shared mail you can edit. Drag the divider between the conversation list and the reader to resize it, or focus it and use the arrow keys. Edge Mail remembers the width on this device. Use **Scheduled** to find messages waiting for their send time. **Approvals** opens outstanding requests you can review. Search operators appear as removable filters, and the URL reopens the same search.

In **Mailboxes & domains**, open the setup page for a domain to see the last observed inbound delivery and outgoing provider acceptance or local capture. Connecting a route with the CLI records the verified routing rules. Refresh DNS to refresh the observations.

## Send feedback to the project

Choose **Feedback** in the sidebar or **Settings → Project feedback**. Pick a category, optionally select an area and describe the problem or suggestion in 200 characters. Add optional reproduction details of up to 2,000 characters. **Review feedback** shows the exact details, including your installed version. Choose **Send privately** to share them with the Edge Mail maintainer. Their authorized coding agents can read reports and maintainer replies to investigate fixes. Leave mailbox contents, addresses and credentials out of both fields.

In **Your reports**, choose **Check for reply** for a status update, a private reply or a linked GitHub issue. Receipts live in the same browser profile under your sign-in. Clearing site data or rotating the installation's setup secret loses access to earlier replies. A failed send can be retried with the original receipt. You can also open a public issue on GitHub.

## Working across mailboxes

Open **All drafts**, **All scheduled** or **All sent** in Workspace. Drafts and schedules show your own work in mailboxes you can edit. Each row names its mailbox. Opening a draft or cancelling a reversible scheduled send returns to its original sending identity. All sent shows the shared sent copies you can read.

In a shared conversation, choose **Claim conversation** to tell colleagues you are handling it. Your name appears in the reader and list. Choose **Release claim** to hand it back. A claim coordinates replies and leaves ordinary reading and replying available to colleagues.

Open **Conversation** in a message and expand an earlier reply to read its text in place. The subject opens the full message. **Jump to latest unread** opens the newest unread reply when it is elsewhere in the thread.

On a phone, the inbox row’s **Conversation actions** button can archive the conversation or snooze it until tomorrow at 9 AM local time. Both actions offer **Undo**. To use gestures, enable **Swipe inbox rows on this device** in Preferences. Swipe right to archive or left to snooze. The reader’s back swipe and the inbox’s pull-to-refresh still work.
