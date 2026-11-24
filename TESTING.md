# Verify an installation

Use Node 24 and the pnpm version in package.json. Install dependencies from the lockfile, install Chromium with `pnpm exec playwright install chromium`, then run `pnpm deploy:check`, `pnpm test:e2e` and `pnpm size`. The suite starts disposable local Workers and storage. The mail provider captures outbound mail. Fixtures and test-only identity bindings live outside the deployed entry point.

The browser journeys cover a mailbox owner importing zones, an editor composing a reply, a reader opening shared mail, a domain administrator managing scoped addresses, an invited person losing access, and a connected agent requesting consent. Recovery checks cover deletion, restore and replay. Desktop and phone views are both exercised.

### Mailbox persona checks

| Role | Browser task | Expected outcome |
| --- | --- | --- |
| First-time owner | Follow the setup link from an empty workspace and add a domain. | The receiving-domain form is one click away and accepts the new domain. |
| Delegated domain admin | Open an empty workspace and create a mailbox for an assigned domain. | Setup opens the mailbox form and the new address appears among the managed mailboxes. |
| Shared reader | Recover from an unavailable bookmark, open a message on a phone, then try a search with no matches. | The bookmark leads back to accessible inboxes. The message shows read-only access. Clearing the search restores the same mailbox and its messages. |
| Shared editor | Mark a message read, reverse it, then mark the selection read. | The sidebar unread count follows each change without a page reload. |

These tasks run in `pnpm test:e2e` with synthetic identities and disposable mailbox contents.

After installing, sign in as the owner, connect one unused recipient and send a fictional receipt to it. Open it from a second device, inspect Delivery details and download an attachment. Send one reply to an address you control and inspect its actual From, Reply-To, Message-ID and delivery outcome. Record these provider observations separately from local captures. Recheck a shared mailbox with a reader account and confirm that its compose and administrative controls are unavailable.

With rclone installed, `pnpm test:backup` uses a loopback S3 service and disposable buckets. It verifies recovery metadata, private Bcc, a deletion after the first copy, and refusal to publish a snapshot with a corrupt part.
