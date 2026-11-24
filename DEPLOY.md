# Install and operate Edge Mail

## Deploy button

1. [Deploy your own copy](https://deploy.workers.cloudflare.com/?url=https://github.com/tannerwj/edge-mail). Connect your Git provider and choose a fresh Worker, D1, KV, R2 and queue names. In build settings select Node 24 and set the deploy command to `pnpm run deploy` so every release applies its database migrations. Use a password manager to generate and store the setup token (32 random bytes or more). The deploy command applies migrations to the selected D1 binding. Save your fork for upgrades.
2. In Zero Trust, open **Access controls → Applications** and add a self-hosted application for the exact hostname you will use, such as `mail.example.com`. Add an Allow policy listing your owner email. Copy the application audience (AUD) and your Zero Trust team domain (such as `your-team.cloudflareaccess.com`).
3. In the new Worker’s **Settings → Domains & Routes**, add custom domains for the app and its sibling content host (such as `mail-content.example.com`). Scope the Access application to the app hostname. The separate content origin checks signed links for message bodies and attachments.
4. In **Settings → Variables and Secrets**, add text bindings `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `CONTENT_ORIGIN` (the full HTTPS content origin). Deploy the changes. Keep the setup token as an encrypted secret. Put your custom domains and non-secret variables in your fork’s Wrangler configuration for future deployments.
5. Visit the app hostname at `/setup`. Sign in and enter the saved token. Setup closes after creating the first owner. Open the app in a signed-out window to confirm it requires sign-in.
6. To populate **Import Cloudflare domains**, run the following in the copy Cloudflare created. The first command previews the changes. Apply configures the public installation and OAuth paths, applies 35-day locks to the raw, Sent, snapshot and deletion prefixes, and verifies the installation before you receive mail.

   ```sh
   pnpm install --frozen-lockfile
   pnpm exec cf auth login
   pnpm exec cf auth whoami
   pnpm install:finish --check WORKER
   pnpm install:finish --apply WORKER
   ```

7. Under **Settings → Mailboxes & domains**, select **Import Cloudflare domains**, choose domains and create your first mailbox. You can also add a domain manually. Connect its receiving route below. To refresh the domain list later use `pnpm domains:sync --apply WORKER`.

### Enable outbound mail on a button installation

In the Cloudflare Email Sending dashboard, verify a dedicated sending subdomain and its requested DNS records. In your fork’s `wrangler.jsonc`, add a sender binding and merge the following fields into the existing variables. Replace both sample addresses and use the name of your actual event queue.

```jsonc
"send_email": [
  { "name": "OUTBOUND", "allowed_sender_addresses": ["receipts@dispatch.example.com"] }
],
"vars": {
  "SEND_MODE": "cloudflare",
  "SEND_FROM": "receipts@dispatch.example.com",
  "SEND_MAILBOX": "support@example.com",
  "EVENT_SENDER": "receipts@dispatch.example.com",
  "EVENT_QUEUE": "edge-mail-events"
}
```

Keep the Access and content-origin variables in place. Deploy from your fork and subscribe the dedicated sending domain’s delivery events to this Worker’s event queue in Cloudflare. Send a message to an address you control and check the envelope and Sent copy. See the [mailbox guide](docs/USING.md#enable-sending-during-installation) for the corresponding guided installer options.

## Guided CLI

For a new installation, the CLI configures both custom domains, owner-only Access, private storage, retention, migrations and the domain catalog. Choose this path at the start. It provisions its own resources.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm exec cf auth login
pnpm exec cf auth whoami
pnpm cloud:install --check --host mail.example.com --owner you@example.com
```

Verify the selected account. Inject `SETUP_TOKEN` from your secret manager and rerun the last command with `--apply`. Keep the token and the installation record printed at completion for upgrades and recovery. Open `https://mail.example.com/setup` and sign in as the specified owner. The CLI applies 35-day locks to raw messages, Sent copies and snapshots. Use `--jurisdiction eu` or `--jurisdiction us` on both commands to select D1 storage jurisdiction.

## Connect a domain

Import zones in Settings. Importing only creates local domain records. Create a mailbox, then preview the exact recipient rule with `pnpm domain:connect --check example.com WORKER --only support@example.com`. Read the existing MX, SPF and routing rules before applying. On an unused domain repeat with `--apply`, then send a fictional message from a separate mailbox and verify its envelope under Delivery details. Connect an existing production mail domain only after exporting its current zone configuration, lowering its MX TTL ahead of time and confirming access to its previous mail provider. Keep the previous inbox available during propagation.

Rollback starts with `pnpm domain:connect --check example.com WORKER --only support@example.com --disconnect`, followed by `--apply`. Restore the original MX, SPF, priorities and TTLs from the saved zone records. Check authoritative DNS and an independent resolver, then send another message and find it in the previous inbox. Keep the Edge Mail receipt backlog until the cutover has settled.

## Upgrade and recover

Read [the changelog](CHANGELOG.md). Record the running Worker version and a D1 Time Travel bookmark, then preview and apply with the same installer host and owner. Keep the installation record in the checkout. Confirm sign-in, authenticated health, a complete inbound receipt and the delivery event of an owned outbound fixture. An installed recipient still needs its own route and an authorized sending identity.

To roll back the Worker, use the version printed by the installer. Keep additive columns and tables for a code rollback. Before restoring a database, pause sending and preserve the live database and R2 deletion records. Restore into disposable resources first, replay deletion records, rebuild search, and verify mailbox isolation. Restored credentials require fresh authorization. Publish the recovery data location, retention period and operator contact in your own privacy notice. See [Privacy](PRIVACY.md), [Architecture](ARCHITECTURE.md) and [Threat model](THREAT_MODEL.md).

## Usage

Check your account's Workers, Email Sending, Queues, D1 and R2 allowances. Every send recipient counts toward sending limits. Attachments, snapshots and locked originals consume storage. Set delivery budgets under Settings. Cloudflare’s [acceptable use policy](https://www.cloudflare.com/acceptable-use-policy/) applies to the operator. The bundled source is MIT licensed. Retain dependency notices when redistributing.

To manage forwarding verification inside Settings, optionally supply the Worker secret `ROUTING_ADDRESS_TOKEN` from your secret manager during installation. Scope it to Email Routing Addresses Write in the installation account. The mailbox owner registers an external address, selects **Request or check verification**, then checks again after the recipient follows Cloudflare’s confirmation link. The installer preserves an existing binding during upgrades. Installations without this permission can use the documented `destination:verify` command.

## Optional MTA-STS and TLS reports

Start in testing mode on a domain with working, explicit MX records. Create a monitored mailbox such as tls-reports@example.com and connect its receiving route. The Worker serves the policy on its own HTTPS hostname. The reporting TXT record directs sending mail servers to that mailbox.

1. Run `pnpm domain:transport --check --report tls-reports@example.com example.com worker-name`. Review the existing MX hosts, reporting address and ownership of the hostname. Repeat with `--apply` to prepare the policy.
2. Run the usual Worker deployment. It attaches `mta-sts.example.com` as a custom domain, provisions HTTPS and retains the hostname through upgrades. A nested subdomain needs certificate coverage for the full policy hostname.
3. Repeat step 1 with `--publish`, first checking and then applying. The command reads the actual public HTTPS policy before writing the MTA-STS discovery and TLS reporting TXT records. Inspect incoming TLS reports and address any delivery failures before selecting `--policy enforce`. Repeat the sequence when the MX changes.
4. To roll back, prepare and publish `--policy none`. Keep the endpoint reachable for the old policy’s maximum lifetime (one day here). After that, remove the owned transport TXT records and the `instance/transport/example.com.txt` object, then redeploy to retire the hostname. A policy change uses R2 reads, DNS operations and a Worker custom domain. It never requires changing MX.

## Copy backups to another account

Use a private, empty destination bucket under your control. Configure two named rclone S3 remotes using credentials from your secret manager. The source needs list and read access. The destination needs list, read and write access. Keep the wrapping secret separately. R2 and S3 object reads, writes, cross-provider transfer and retained copies can incur charges.

1. Choose a published snapshot ID. Run `pnpm backup:copy --check --source primary:mail-receipts --destination recovery:mail-copy --snapshot 2026-11-24`.
2. Repeat with `--apply`. The command copies mail with its object metadata, copies the chosen snapshot parts, and synchronizes message and person deletion records. It checks source and destination objects, raw envelope metadata and snapshot digests before recording a completed recovery point. Retrying after an interruption reuses existing objects.
3. Run `pnpm backup:copy --status --destination recovery:mail-copy` to see the newest recovery point and elapsed time since the last deletion scan. Schedule copies with the backup service you control. Repeat the copy before opening a restored mailbox and reconcile the most recent deletion journals. During a source outage, the reported lag is the window that still needs reconciliation.
4. To stop replication, disable its schedule and revoke its destination credentials. Keep the deletion journals for as long as the destination retains any corresponding backups. Restrict the offline copy throughout its retention period.

Recovery also scans raw receipts through a fixed cutoff after restoring the snapshot tables. It indexes receipts absent from the bookmark with their original SMTP envelopes and runs zero arrival actions. If a receipt belongs to a mailbox created after the bookmark, its source object stays available and the recovery database records its key in `restore_unmapped_receipts`. Confirm the mailbox and its current membership before importing that original. Keep live traffic on the existing installation during verification.

## Recover an installed instance

Use the Cloudflare CLI profile that owns the recovery resources. Preview the latest complete backup, then pass the snapshot ID printed in that preview to apply. You can also supply a specific snapshot ID when previewing.

```sh
pnpm backup:restore --check --worker WORKER
pnpm backup:restore --apply --worker WORKER --snapshot SNAPSHOT
```

The preview reads the deployed storage bindings and published manifest. Apply creates a dedicated database, bucket and scheduled recovery Worker. It copies the mail, reconciles newer receipts and deletion journals, rebuilds search, checks isolation, and removes the schedule. Repeating the command resumes that recovery point. The result includes the resource names and counts. The scratch copy consumes D1 and R2 storage and Worker and storage operations.

When recovering from another account, choose the destination profile and replace `--worker WORKER` with `--bucket RESTORED-R2-BUCKET`. For a non-R2 backup, copy its complete contents and object metadata into a private R2 bucket first. Compare the latest deletion-sync time and retain the original wrapping secret separately. Verify mailbox ownership and a sample of threads and private envelopes before an intentional cutover. Live DNS and mail continue to use the original installation throughout the rehearsal.

## Update a button installation

Cloudflare creates a copy under your Git account. Add the public project as a remote in that copy, fetch it, and review the changelog and migrations before merging.

```sh
git remote add upstream https://github.com/tannerwj/edge-mail.git
git fetch upstream
git diff HEAD upstream/master -- migrations wrangler.jsonc package.json
```

Keep your copy’s Worker name, resource bindings, custom domains and Access settings when merging. Save the active Worker version and D1 Time Travel bookmark first. Pushing the reviewed change to the branch connected to Workers Builds runs the deploy command again. Check sign-in and receive a fictional message before treating the upgrade as complete.
