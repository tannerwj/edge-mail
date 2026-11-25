import { exports as workerExports, bindings, defineConfig, triggers } from "cf/config";

function assistantBinding() {
  return process.env.EDGE_ENABLE_AI === "yes" ? { AI: bindings.ai() } : {};
}
function providerAccess() {
  const names = (process.env.EDGE_PROVIDER_BINDINGS || "").split(",");
  return {
    ...(names.includes("ACCOUNT_ANALYTICS_TOKEN")
      ? { ACCOUNT_ANALYTICS_TOKEN: bindings.secret() }
      : {}),
    ...(names.includes("ROUTING_ADDRESS_TOKEN")
      ? { ROUTING_ADDRESS_TOKEN: bindings.secret() }
      : {}),
    ...(names.includes("SUPPRESSION_API_TOKEN")
      ? { SUPPRESSION_API_TOKEN: bindings.secret() }
      : {}),
  };
}
function eventsFor(name: string) {
  const sender = process.env.EDGE_EVENT_SENDER;
  return sender
    ? {
        triggers: [
          triggers.queue({
            name: name + "-events",
            maxBatchSize: 10,
            maxBatchTimeout: 2,
            maxRetries: 5,
            deadLetterQueue: name + "-events-dlq",
          }),
        ],
        env: { EVENT_SENDER: bindings.text(sender), EVENT_QUEUE: bindings.text(name + "-events") },
      }
    : { triggers: [], env: {} };
}
function outbound(stage: boolean) {
  if (stage) return { SEND_MODE: bindings.text("capture") };
  const from = process.env.EDGE_SEND_FROM,
    mailbox = process.env.EDGE_SEND_MAILBOX;
  if (!from || !mailbox) return {};
  const identities: { from: string; mailbox: string }[] = JSON.parse(
    process.env.EDGE_SEND_IDENTITIES || "[]",
  );
  return {
    SEND_MODE: bindings.text("cloudflare"),
    SEND_FROM: bindings.text(from),
    SEND_MAILBOX: bindings.text(mailbox),
    ...(identities.length ? { SEND_IDENTITIES: bindings.text(JSON.stringify(identities)) } : {}),
    OUTBOUND: bindings.sendEmail({
      allowedSenderAddresses: [...new Set([from, ...identities.map((v) => v.from)])],
    }),
  };
}
function idProbeConfig() {
  const run = process.env.EDGE_ID_RUN,
    from = process.env.EDGE_ID_FROM,
    to = process.env.EDGE_ID_TO;
  if (!run || !/^id-[0-9a-f]{16}$/.test(run) || !from || !to)
    throw Error("Fixed probe sender, recipient and run required");
  return {
    worker: {
      name: "edge-mail-staging-id-probe",
      entrypoint: "staging/id-probe.ts",
      workersDev: false,
      previewUrls: false,
      compatibilityDate: "2026-11-23",
      compatibilityFlags: ["nodejs_compat"],
      triggers:
        process.env.EDGE_PROBE_ACTIVE === "yes"
          ? [triggers.scheduled({ schedule: "* * * * *" })]
          : [],
      env: {
        RUN: bindings.text(run),
        FROM: bindings.text(from),
        TO: bindings.text(to),
        MAIL: bindings.r2({ name: "edge-mail-staging-receipts" }),
        EMAIL: bindings.sendEmail({
          allowedSenderAddresses: [from],
          allowedDestinationAddresses: [to],
        }),
      },
    },
  };
}
function smtpConfig() {
  const run = process.env.EDGE_SMTP_RUN,
    from = process.env.EDGE_SMTP_FROM;
  if (!run || !/^[a-f0-9]{12}$/.test(run) || !from)
    throw Error("Explicit SMTP spike configuration required");
  return {
    worker: {
      name: "edge-mail-smtp-" + run,
      entrypoint: "staging/smtp-worker.ts",
      workersDev: false,
      previewUrls: false,
      compatibilityDate: "2026-11-23",
      compatibilityFlags: ["nodejs_compat"],
      env: {
        SPIKE_RUN: bindings.text(run),
        SPIKE_FROM: bindings.text(from),
        DB: bindings.d1({ name: "edge-mail-staging" }),
        MAIL: bindings.r2({ name: "edge-mail-staging-receipts" }),
        INGEST: bindings.queue<string>({ name: "edge-mail-staging-ingest" }),
      },
    },
  };
}
function restoreConfig() {
  const target = process.env.EDGE_DRILL_TARGET;
  if (!target || !/^edge-mail-drill-[0-9a-f]{12}$/.test(target))
    throw Error("Invalid isolated restore target");
  const source = process.env.EDGE_DRILL_SOURCE || "edge-mail-staging-receipts";
  const worker = process.env.EDGE_DRILL_WORKER || "edge-mail-staging-restore";
  if (
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(source) ||
    source === target ||
    (worker !== target + "-restore" && worker !== "edge-mail-staging-restore")
  )
    throw Error("Invalid recovery source or worker");
  return {
    worker: {
      name: worker,
      entrypoint: "staging/restore-worker.ts",
      compatibilityDate: "2026-11-23",
      compatibilityFlags: ["nodejs_compat"],
      workersDev: false,
      previewUrls: false,
      triggers:
        process.env.EDGE_DRILL_ACTIVE === "yes"
          ? [triggers.scheduled({ schedule: "* * * * *" })]
          : [],
      env: {
        DB: bindings.d1({ name: target }),
        TARGET: bindings.r2({ name: target }),
        SOURCE: bindings.r2({ name: source }),
      },
    },
  };
}

function probeConfig(stage: boolean) {
  const live = stage && process.env.PROBE_MODE === "cloudflare";
  const from = process.env.PROBE_FROM,
    to = process.env.PROBE_TO,
    run = process.env.PROBE_RUN;
  if (live && (!from || !to || !run))
    throw new Error("Live staging probe requires PROBE_FROM, PROBE_TO and PROBE_RUN");
  return { live, from, to, run };
}
function instanceName(mode: string | undefined, stage: boolean) {
  const name =
    mode === "self-host"
      ? process.env.EDGE_INSTANCE_NAME
      : stage
        ? "edge-mail-staging"
        : "edge-mail";
  if (!name || !/^edge-mail(?:-[a-z0-9-]+)?$/.test(name)) throw Error("Invalid Worker name");
  return name;
}
const transportHosts = () => (process.env.EDGE_TRANSPORT_HOSTS || "").split(",").filter(Boolean);
const accountBinding = () => bindings.text(process.env.EDGE_MAIL_ACCOUNT ?? "");
export default defineConfig(({ mode }) => {
  if (mode === "id-probe") return idProbeConfig();
  if (mode === "smtp-spike") return smtpConfig();
  if (mode === "restore") return restoreConfig();
  const stage = mode === "staging";
  const name = instanceName(mode, stage);
  const queue = name + "-ingest";
  const { live, from, to, run } = probeConfig(stage);
  return {
    worker: {
      name,
      exports: {
        MailboxLive: workerExports.durableObject({ storage: "sqlite" }),
        OutboxClock: workerExports.durableObject({ storage: "sqlite" }),
      },
      ...(process.env.EDGE_MAIL_HOST
        ? {
            domains: [
              process.env.EDGE_MAIL_HOST,
              ...transportHosts(),
              ...(process.env.EDGE_CONTENT_HOST ? [process.env.EDGE_CONTENT_HOST] : []),
            ],
            workersDev: false,
          }
        : {}),
      entrypoint: stage ? "staging/worker.ts" : "src/worker.ts",
      compatibilityDate: "2026-11-23",
      compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
      assets: { notFoundHandling: "single-page-application", runWorkerFirst: true },
      previewUrls: false,
      observability: { enabled: true, logs: { invocationLogs: false }, traces: { enabled: false } },
      triggers: [
        triggers.scheduled({ schedule: "*/5 * * * *" }),
        ...eventsFor(name).triggers,
        triggers.queue({
          name: queue,
          maxBatchSize: 1,
          maxBatchTimeout: 1,
          maxRetries: 3,
          deadLetterQueue: queue + "-dlq",
        }),
      ],
      env: {
        INSTALL_WORKER: bindings.text(name),
        OAUTH_KV: bindings.kv({ id: process.env.EDGE_OAUTH_KV || "0".repeat(32) }),
        ...assistantBinding(),
        LOADER: bindings.workerLoader(),
        LIVE: bindings.durableObject({ worker: name, exportName: "MailboxLive" }),
        OUTBOX_CLOCK: bindings.durableObject({ worker: name, exportName: "OutboxClock" }),
        MAIL_ACCOUNT_ID: accountBinding(),
        ...providerAccess(),
        ...outbound(stage),
        ...eventsFor(name).env,
        ...(stage ? { PROBE_MODE: bindings.text(live ? "cloudflare" : "capture") } : {}),
        ...(live && from && to && run
          ? {
              PROBE_FROM: bindings.text(from),
              PROBE_TO: bindings.text(to),
              PROBE_RUN: bindings.text(run),
              EMAIL: bindings.sendEmail({
                allowedSenderAddresses: [from],
                allowedDestinationAddresses: [to],
              }),
            }
          : {}),
        ...(stage && process.env.VERIFICATION_CLIENT_DIGEST
          ? {
              VERIFICATION_CLIENT_DIGEST: bindings.text(process.env.VERIFICATION_CLIENT_DIGEST),
            }
          : {}),
        DB: bindings.d1({ name }),
        MAIL: bindings.r2({ name: name + "-receipts" }),
        ASSETS: bindings.assets(),
        ...(process.env.EDGE_CONTENT_HOST
          ? { CONTENT_ORIGIN: bindings.text("https://" + process.env.EDGE_CONTENT_HOST) }
          : {}),
        INGEST: bindings.queue<string>({ name: queue }),
        SETUP_TOKEN: bindings.secret(),
        ACCESS_TEAM_DOMAIN: bindings.text(process.env.ACCESS_TEAM_DOMAIN || ""),
        ACCESS_AUD: bindings.text(process.env.ACCESS_AUD || ""),
        SETUP_LIMIT: bindings.rateLimit({
          namespace: stage ? "2001" : "1001",
          simple: { limit: 10, period: 60 },
        }),
      },
    },
  };
});
