import { ulid } from "ulid";
import * as z from "zod/mini";
import { domainName } from "../address";
import { Problem, type Bindings, type Principal } from "../env";
import { administrator, human } from "./access";

const catalogSchema = z.object({
  updated: z.string(),
  zones: z.array(z.object({ id: z.string(), name: z.string() })),
});

async function inventory(env: Bindings, user: Principal) {
  administrator(user);
  const file = await env.MAIL.get("instance/zone-catalog.json");
  if (!file) return { version: "", updated: "", zones: [] };
  const data = catalogSchema.parse(await file.json());
  return { ...data, version: file.etag };
}

export async function availableDomains(env: Bindings, user: Principal) {
  const catalog = await inventory(env, user);
  const existing = await env.DB.prepare("SELECT id,name FROM domains").all<{
    id: string;
    name: string;
  }>();
  const names = new Map(existing.results.map((row) => [row.name, row.id]));
  return {
    ...catalog,
    zones: catalog.zones.map((zone) => ({
      ...zone,
      imported: names.has(zone.name),
      domain_id: names.get(zone.name) ?? null,
    })),
  };
}

export async function importDomains(
  env: Bindings,
  user: Principal,
  input: Record<string, unknown>,
) {
  const catalog = await inventory(env, user);
  if (!catalog.version || input.version !== catalog.version)
    throw new Problem(
      409,
      "The domain list has changed. Refresh it and choose your domains again.",
    );
  const ids = z.array(z.string()).check(z.minLength(1), z.maxLength(50)).safeParse(input.zones);
  if (!ids.success) throw new Problem(400, "Choose between one and 50 domains.");
  const selected = new Set(ids.data);
  const zones = catalog.zones.filter((zone) => selected.has(zone.id));
  if (zones.length !== selected.size) throw new Problem(400, "Unknown zone in this installation.");
  const rows = zones.map((zone) =>
    env.DB.prepare(
      "INSERT INTO domains(id,name,created_by) SELECT ?,?,id FROM users WHERE id=? AND disabled_at IS NULL AND role IN ('admin','owner') ON CONFLICT(name) DO NOTHING",
    ).bind(ulid(), domainName(zone.name), human(user).id),
  );
  const results = await env.DB.batch(rows);
  const created = results.reduce((total, result) => total + result.meta.changes, 0);
  return { created, existing: zones.length - created };
}
