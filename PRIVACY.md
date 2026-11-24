# Mail data and retention

The installer operates the service in their Cloudflare account. The operator controls Access policies, mailbox grants, receiving domains, outbound senders, forwarding rules and webhook recipients. Instance owners and administrators can read mailbox content. Tell mailbox users who operates the instance and where to request access, export or deletion.

Raw messages, SMTP envelopes, attachments, outgoing Bcc, drafts, application users, memberships, routing rules and search data are stored in the account's D1, R2 and associated Worker services. The sender's mail service and receiving provider can retain their own copies. A reader who chooses to load remote images causes the Worker to contact the image host, which may recognize a message-specific URL. Browser push providers receive encrypted notifications. Offline reading and downloaded exports put data under the recipient device's control.

A mailbox owner can export originals and erase individual messages. Trash and Spam expire after 30 days. The app retains content-free deletion records to prevent recovery from older backups. R2 retention locks can preserve raw objects for 35 days. D1 Time Travel uses the account plan's recovery window. Off-account backups, recipients, local exports and disconnected devices have separate retention periods. Preserve deletion records alongside every restorable backup.

The operator chooses which sending and forwarding workflows to enable and who may configure them. Before onboarding other people, publish a contact for support and privacy requests, describe the installation's actual retention and hosting settings, and confirm which obligations apply to that use.

### Optional assistance

When enabled by the installer and mailbox owner, an explicit assistance request shares a search description or excerpts of up to five messages with Cloudflare Workers AI. The application keeps a per-mailbox daily request count. Generated suggestions are displayed to the requesting person. Labels, rules or sent drafts require a separate user action.

## Optional project feedback

Sending a private report shares the reviewed category, summary, optional area and software version with the Edge Mail maintainer. The installation sends it to `edge-mail-feedback.tannerwj.dev` through its Worker using a report-specific receipt. The report excludes mailbox contents, account identifiers and the installation hostname unless you write them in the summary. Opening Feedback or reviewing a draft does not contact the maintainer. Checking for a reply uses the receipt. The maintainer stores reports and replies separately from mail. Browser history for reports stays on the device until you remove the receipt or clear site data. Operators can set the Worker variable `PROJECT_FEEDBACK` to `off` to disable private submissions and reply checks.
