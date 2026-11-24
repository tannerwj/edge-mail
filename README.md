# Edge Mail

A self-hosted inbox for the domains you own on Cloudflare. Read mail from all your domains together, share a mailbox with someone, or give an app access to one mailbox. Cloudflare Access handles sign-in. Your account stores the messages and attachments.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tannerwj/edge-mail)

## Install

You need an active Cloudflare domain, Zero Trust with a working sign-in method, Workers and enabled R2 and Queues. Check your plan for Worker Loaders. Mail storage, queue operations, Worker execution and optional outbound sending use your account’s allowances.

1. Open **Deploy to Cloudflare**, sign in, and select your personal account. If sign-in takes you to the account home, open the Deploy button again. Choose fresh names for the Worker and its resources. Save a random setup token of at least 32 bytes in your password manager and enter it as `SETUP_TOKEN`.
2. Connect your app hostname and configure an owner-only Access policy. Open `/setup` on that hostname, sign in, and enter your token to claim the first owner account. The [installation guide](DEPLOY.md#deploy-button) walks through the dashboard settings. It also includes a [guided CLI install](DEPLOY.md#guided-cli) that configures Access and both hostnames for you.
3. Import the domains you want, create your first address, and connect its receiving route. Start with one unused address. Domain import alone leaves your current mail delivery in place. [Connect a domain](DEPLOY.md#connect-a-domain)

## In the inbox

- Read across mailboxes or by domain. Search, label, snooze, or assign follow-up reminders.
- Compose, reply, and forward in a dockable window. An open or minimized draft survives refresh. Paste screenshots, move recipients between To, Cc and Bcc, schedule delivery, or undo a send or discard.
- Give someone read or edit access to a shared mailbox. Drafts and Bcc stay private to the author.
- Inspect the original message and delivery details, download attachments on a separate hostname, and export your mail.

See the [mailbox guide](docs/USING.md) for forwarding, aliases, notifications and integrations.

## Try it locally

Use Node 24 and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL and add `example.test` and `support@example.test` under **Settings → Mailboxes & domains**. Deliver the included sample receipt:

```sh
curl --request POST 'http://127.0.0.1:8787/cdn-cgi/local/email?from=customer%40outside.test&to=support%40example.test' \
  --data-binary @tests/customer.eml
```

## Project

[Deployment and recovery](DEPLOY.md) · [Verification](TESTING.md) · [Architecture](ARCHITECTURE.md) · [Threat model](THREAT_MODEL.md) · [Privacy](PRIVACY.md) · [Changelog](CHANGELOG.md) · [MIT license](LICENSE)

## Feedback

Open **Feedback** in your installed sidebar to send a private report to the project maintainer and check for a reply. For public discussion, [open a GitHub issue](https://github.com/tannerwj/edge-mail/issues/new?template=feedback.yml).
