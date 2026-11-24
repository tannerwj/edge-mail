import assert from "node:assert/strict";
import { api, pages } from "./cloud-cli.mjs";
export function validDomain(value) {
  return (
    typeof value === "string" &&
    value.length <= 245 &&
    value.includes(".") &&
    value.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}
export function transportHost(domain, worker) {
  assert.ok(validDomain(domain), "Invalid transport policy domain");
  const hostname = "mta-sts." + domain;
  // Look up the most specific active zone, including separately delegated subdomains.
  const zones = pages(["zones", "list", "--status", "active"]);
  const zone = zones
    .filter((z) => domain === z.name || domain.endsWith("." + z.name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  assert.ok(zone, "Missing active Cloudflare zone");
  for (let sub = domain; sub !== zone.name; sub = sub.slice(sub.indexOf(".") + 1))
    assert.equal(
      pages(["dns", "records", "list", "--zone", zone.id, "--name", sub, "--type", "NS"]).length,
      0,
      "A child nameserver delegation controls this domain",
    );
  const records = pages(["dns", "records", "list", "--zone", zone.id, "--name", hostname]);
  const bound = worker.references.domains.find(
    (d) => d.hostname === hostname && d.zone_id === zone.id,
  );
  assert.ok(
    records.every((r) => bound && r.meta?.read_only && r.meta.origin_worker_id === bound.id),
    "Existing DNS or another Worker owns the transport hostname",
  );
  return { hostname, zone, bound };
}
export function transportHosts(bucket, worker) {
  if (!worker) return [];
  const prefix = "instance/transport/";
  const rows = api(
    "r2",
    "objects",
    "list",
    "--bucket-name",
    bucket,
    "--prefix",
    prefix,
    "--per-page",
    "100",
  );
  assert.ok(Array.isArray(rows) && rows.length < 100, "Too many transport policy hostnames");
  return rows
    .map(({ key }) => {
      assert.ok(key.startsWith(prefix) && key.endsWith(".txt"), "Unexpected transport policy key");
      return transportHost(key.slice(prefix.length, -4), worker).hostname;
    })
    .sort((a, b) => a.localeCompare(b));
}
