import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { api } from "../cloud-cli.mjs";
import assets from "../../src/install-assets.json" with { type: "json" };
const originalPaths = [assets.manifest, ...assets.icons];
const offlinePaths = [...originalPaths, ...Object.keys(assets.reader)];
const integrationPaths = [
  ...offlinePaths,
  "/mcp",
  "/v1/*",
  "/.well-known/oauth-protected-resource/mcp",
];
const paths = [
  ...integrationPaths,
  "/.well-known/oauth-authorization-server",
  "/oauth/register",
  "/oauth/token",
];
const name = "Edge Mail install artwork";
const everyone = { everyone: {} };
export function installAccess(target, apply) {
  const uris = paths.map((path) => target.host + path);
  const apps = api("zero-trust", "access", "applications", "list");
  const title = name + " (" + target.stage + ")";
  const matches = apps.filter(
    (a) =>
      a.name === title ||
      a.destinations?.some((d) => uris.includes(d.uri)) ||
      uris.includes(a.domain),
  );
  const app = matches[0];
  if (app) {
    assert.equal(matches.length, 1, "Conflicting install artwork application");
    assert.equal(app.name, title);
    const current = app.destinations.map((d) => d.uri).sort();
    assert.equal(app.policies.length, 1);
    assert.equal(app.policies[0].decision, "bypass");
    if (JSON.stringify(current) === JSON.stringify([...uris].sort())) return;
    assert.ok(
      [originalPaths, offlinePaths, integrationPaths].some(
        (group) =>
          JSON.stringify(current) ===
          JSON.stringify(group.map((path) => target.host + path).sort()),
      ),
      "Unexpected Access application scope",
    );
  }
  const args = [
    "zero-trust",
    "access",
    "applications",
    ...(app ? ["update", app.id] : ["create"]),
    "--body",
    JSON.stringify({
      name: title,
      type: "self_hosted",
      app_launcher_visible: false,
      destinations: uris.map((uri) => ({ type: "public", uri })),
      policies: app
        ? [{ id: app.policies[0].id, precedence: 1 }]
        : [
            {
              name: "Public installation assets",
              decision: "bypass",
              precedence: 1,
              include: [everyone],
            },
          ],
    }),
  ];
  api(...args, "--dry-run");
  if (apply) api(...args);
}
async function checkAssets(target) {
  const origin = "https://" + target.host;
  const get = (path) =>
    fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(12000) });
  const manifest = await get(paths[0]);
  assert.equal(manifest.status, 200, "Manifest must be available before sign-in");
  const m = await manifest.json();
  assert.equal(m.start_url, "/app");
  assert.deepEqual(
    m.icons.map((i) => i.src),
    assets.icons,
  );
  for (const path of assets.icons) {
    const icon = await get(path);
    assert.equal(icon.headers.get("Content-Type")?.split(";")[0], "image/png");
    assert.equal(Buffer.from(await icon.arrayBuffer()).readUInt32BE(), 0x89504e47);
  }
  for (const [path, mime] of Object.entries(assets.reader)) {
    const r = await get(path);
    assert.equal(r.status, 200);
    assert.ok(
      r.headers.get("content-type")?.includes(mime),
      "Offline asset returned the wrong type: " + path,
    );
  }
  const discover = await get("/.well-known/oauth-authorization-server");
  assert.equal(discover.status, 200, "Authorization metadata must be available before sign-in");
  assert.equal((await discover.json()).issuer, origin);
  for (const path of ["/mcp", "/v1/whoami"]) {
    const anonymous = await get(path);
    assert.equal(anonymous.status, 401, "Agent endpoints require a bearer token");
    assert.match(anonymous.headers.get("www-authenticate") || "", /resource_metadata=/);
  }
  assert.ok(
    [302, 303, 307].includes((await get("/api/offline/session")).status),
    "Offline mail must require Access",
  );
  assert.ok(
    [302, 303, 307].includes((await get("/api/session")).status),
    "Anonymous session must require Access",
  );
}

export async function verifyInstall(target) {
  const deadline = Date.now() + 90000;
  for (;;) {
    try {
      return await checkAssets(target);
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await sleep(3000);
    }
  }
}
