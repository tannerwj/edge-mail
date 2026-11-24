import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { api, pages } from "./cloud-cli.mjs";

const events = ["delivered", "deferred", "bounced", "rejected", "failed", "complained"].map(
  (k) => "message." + k,
);
export function checkSubscription(source, queue) {
  const matches = pages(["queues", "subscriptions", "list"]).filter(
    (s) =>
      s.source?.type === source.type &&
      s.source.zone_id === source.zone_id &&
      s.source.domain === source.domain,
  );
  if (!matches.length) return false;
  assert.ok(
    matches.length === 1 &&
      matches[0].enabled &&
      matches[0].destination.queue_id === queue?.queue_id &&
      events.every((e) => matches[0].events.includes(e)),
    "This sending domain already delivers events to a different subscription. Choose a dedicated sending subdomain.",
  );
  return true;
}
export function subscribe(source, queueName) {
  const queue = pages(["queues", "list"]).find((q) => q.queue_name === queueName);
  assert.ok(queue?.queue_id, "Create the delivery event queue first");
  if (checkSubscription(source, queue)) return;
  const args = [
    "queues",
    "subscriptions",
    "create",
    "--body",
    JSON.stringify({
      name: queueName,
      enabled: true,
      source,
      destination: { type: "queues.queue", queue_id: queue.queue_id },
      events,
    }),
  ];
  api(...args, "--dry-run");
  const sub = api(...args);
  assert.ok(sub.enabled && sub.destination.queue_id === queue.queue_id);
}

export function senderPlan(zones, worker, from, mailbox, queues) {
  if (!from && !mailbox) return null;
  const addr = /^[a-z0-9][a-z0-9._+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
  assert.ok(
    addr.test(from) && addr.test(mailbox),
    "Supply both --sender and --sending-mailbox as lowercase addresses",
  );
  const locate = (address) =>
    zones.find(
      (z) => address.endsWith("@" + z.name) || address.split("@")[1].endsWith("." + z.name),
    );
  const zone = locate(from);
  assert.ok(
    zone && locate(mailbox),
    "Choose a sender and reply mailbox under active zones in the selected account",
  );
  const domain = from.split("@")[1];
  for (let label = domain; label !== zone.name; label = label.slice(label.indexOf(".") + 1)) {
    const delegation = api(
      "dns",
      "records",
      "list",
      "--zone",
      zone.id,
      "--name",
      label,
      "--type",
      "NS",
    );
    assert.equal(delegation.length, 0, "The sending subdomain is delegated elsewhere");
  }
  const source = { type: "email.sending", zone_id: zone.id, domain };
  const prefix = ["email-sending", "subdomains"];
  const args = ["--name", domain, "--zone", zone.id];
  const preview = () => api(...prefix, "preview", ...args);
  const plan = preview();
  assert.ok(Array.isArray(plan.records) && plan.records.length > 0);
  const missing = plan.errors ?? [];
  assert.ok(
    missing.every((e) =>
      ["mx.missing", "spf.missing", "dkim.missing", "dmarc.missing"].includes(e.code),
    ),
    "Conflicting sending DNS. Review the provider preview before changing records.",
  );
  const row = api(...prefix, "list", "--zone", zone.id).find((d) => d.name === domain);
  assert.ok(
    !row || (row.enabled && !missing.length),
    "An existing sender has disabled or incomplete DNS. Review it before upgrading.",
  );
  const queueName = worker + "-events";
  checkSubscription(
    source,
    queues.find((q) => q.queue_name === queueName),
  );
  if (!row) api(...prefix, "create", ...args, "--dry-run");
  console.log(
    (row ? "Reuse " : "Onboard ") +
      domain +
      " for " +
      from +
      " with reply mailbox " +
      mailbox +
      ".",
  );
  for (const r of plan.records) console.log("  " + r.type + " " + r.name);
  return {
    source,
    queueName,
    apply: async () => {
      if (row) return;
      api(...prefix, "create", ...args);
      for (let attempt = 0; attempt < 30; attempt++) {
        if (!(preview().errors ?? []).length) return;
        await sleep(2000);
      }
      throw Error(
        "Sending DNS is still propagating. Repeat the installation with the same addresses.",
      );
    },
  };
}
