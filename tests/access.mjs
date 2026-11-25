import { feedbackService, exerciseFeedback } from "./project-feedback.mjs";
import { exerciseList, publisher } from "./publisher.mjs";
import { operatorService, exerciseOperatorService } from "./mail-provider-settings.mjs";
import { hookReceiver, exerciseHooks } from "./webhooks.mjs";
import { imageService, exerciseImages } from "./remote-images.mjs";
import { pushReceiver, exercisePush } from "./push-service.mjs";
import { unstable_splitSqlQuery } from "wrangler";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const dir = await mkdtemp(join(tmpdir(), "edge-mail-access-"));
const team = "fixture.cloudflareaccess.com",
  issuer = "https://" + team;
const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
const setupToken = randomBytes(32).toString("hex");
const claims = {
  iss: issuer,
  aud: "mail-app",
  email: "owner@example.test",
  sub: "user-1",
  type: "app",
  exp: Math.floor(Date.now() / 1000) + 300,
};
const feedback = feedbackService();
const receiver = pushReceiver();
const images = imageService();
const lists = publisher();
const hooks = hookReceiver();
const operator = operatorService();
let serveKeys = false,
  worker;
try {
  execFileSync(
    "./node_modules/.bin/wrangler",
    ["deploy", "--config", "wrangler.jsonc", "--dry-run", "--outdir", dir],
    { stdio: "pipe" },
  );
  worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: await readFile(join(dir, "worker.js"), "utf8"),
        },
      ],
      compatibilityDate: "2026-11-19",
      compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
      d1Databases: ["DB"],
      r2Buckets: ["MAIL"],
      kvNamespaces: ["OAUTH_KV"],
      workerLoaders: { LOADER: {} },
      ratelimits: { SETUP_LIMIT: { namespace_id: "1001", simple: { limit: 10, period: 60 } } },
      bindings: {
        SETUP_TOKEN: setupToken,
        ROUTING_ADDRESS_TOKEN: "fixture-routing",
        SUPPRESSION_API_TOKEN: "fixture-suppressions",
        ACCOUNT_ANALYTICS_TOKEN: "fixture-analytics",
        MAIL_ACCOUNT_ID: "a".repeat(32),
        SEND_FROM: "orders@dispatch.test",
        SEND_MAILBOX: "push@example.test",
        CONTENT_ORIGIN: "https://content.example.test",
        ACCESS_TEAM_DOMAIN: team,
        ACCESS_AUD: "mail-app",
        DEV_IDENTITY: claims.email,
      },
      outboundService: (request) => {
        const url = new URL(request.url);
        if (url.href === "https://edge-mail-feedback.tannerwj.dev/v1/report")
          return feedback.receive(request);
        if (url.origin === "https://api.cloudflare.com") return operator.receive(request);
        if (url.origin === "https://hooks.example.test") return hooks.receive(request);
        if (url.origin === "https://subscriptions.publisher.test") return lists.receive(request);
        if (url.origin === "https://images.example.test") return images.receive(request);
        if (url.origin === "https://fcm.googleapis.com") return receiver.receive(request);
        if (url.href === "https://client.example.test/oauth/client.json")
          return Response.json({
            client_id: url.href,
            client_name: "Local CIMD client",
            redirect_uris: ["https://client.example.test/connect"],
            token_endpoint_auth_method: "none",
          });
        if (url.origin === "https://cloudflare-dns.com") {
          assert.equal(url.pathname, "/dns-query");
          if (
            ["images.example.test", "hooks.example.test", "subscriptions.publisher.test"].includes(
              url.searchParams.get("name"),
            )
          )
            return Response.json({
              Status: 0,
              Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "1.1.1.1" }] : [],
            });
          return Response.json({
            Status: 0,
            Answer:
              url.searchParams.get("type") === "MX"
                ? [{ type: 15, data: "10 before.example.test." }]
                : [],
          });
        }
        assert.equal(request.url, issuer + "/cdn-cgi/access/certs");
        return serveKeys ? Response.json({ keys: [jwk] }) : new Response("", { status: 503 });
      },
    }),
  );
  const db = await worker.getD1Database("DB");
  for (const name of (await readdir("migrations")).filter((n) => n.endsWith(".sql")).sort()) {
    const statements = unstable_splitSqlQuery(await readFile("migrations/" + name, "utf8"));
    for (const stmt of statements) await db.prepare(stmt).run();
  }
  const call = async (overrides = {}, key = privateKey, alg = "RS256") => {
    const jwt = await new SignJWT({ ...claims, ...overrides })
      .setProtectedHeader({ alg, kid: jwk.kid })
      .sign(key);
    return worker.dispatchFetch("http://127.0.0.1/api/session", {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    });
  };
  assert.equal((await call()).status, 503);
  serveKeys = true;
  const valid = await call();
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).email, claims.email);
  async function firstRun(email) {
    const jwt = await new SignJWT({ ...claims, email })
      .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
      .sign(privateKey);
    return worker.dispatchFetch("http://127.0.0.1/api/setup", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1",
        "Content-Type": "application/json",
        "Cf-Access-Jwt-Assertion": jwt,
      },
      body: JSON.stringify({ token: setupToken }),
    });
  }
  const race = await Promise.all([firstRun(claims.email), firstRun("second@example.test")]);
  assert.deepEqual(
    race.map((r) => r.status).sort((a, b) => a - b),
    [201, 410],
  );
  assert.equal(
    await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='owner'").first("n"),
    1,
  );
  const owner = await db.prepare("SELECT id FROM users WHERE role='owner'").first("id");
  const ownerEmail = await db
    .prepare("SELECT email FROM user_emails WHERE user_id=?")
    .bind(owner)
    .first("email");
  await db
    .prepare("INSERT INTO domains(id,name,created_by) VALUES('domain-fixture','example.test',?)")
    .bind(owner)
    .run();
  const ownerJWT = await new SignJWT({ ...claims, email: ownerEmail })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .sign(privateKey);
  await db.prepare("INSERT INTO users(id,role) VALUES('feedback-member','member')").run();
  await db
    .prepare(
      "INSERT INTO user_emails(email,user_id) VALUES('feedback-member@example.test','feedback-member')",
    )
    .run();
  const memberJWT = await new SignJWT({
    ...claims,
    email: "feedback-member@example.test",
    sub: "feedback-member",
  })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .sign(privateKey);
  await exerciseFeedback(worker, ownerJWT, memberJWT, feedback);
  await exercisePush(worker, ownerJWT, receiver, db);
  await exerciseImages(worker, ownerJWT, db, images);
  await exerciseList(worker, ownerJWT, db, lists);
  await exerciseHooks(worker, ownerJWT, db, hooks, receiver);
  await exerciseOperatorService(worker, ownerJWT, operator);
  const cimd = await worker.dispatchFetch("http://127.0.0.1/api/oauth/consent", {
    method: "POST",
    headers: {
      "cf-access-jwt-assertion": ownerJWT,
      origin: "http://127.0.0.1",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "begin",
      query: new URLSearchParams({
        client_id: "https://client.example.test/oauth/client.json",
        redirect_uri: "https://client.example.test/connect",
        response_type: "code",
        resource: "http://127.0.0.1/mcp",
        scope: "mail.read",
        code_challenge: "A".repeat(43),
        code_challenge_method: "S256",
      }).toString(),
    }),
  });
  assert.equal(cimd.status, 200, "Signed-in owner can inspect a CIMD client");
  assert.equal((await cimd.json()).details.clientDomain, "client.example.test");
  const catalog = await worker.getR2Bucket("MAIL");
  const policyUrl = "https://mta-sts.example.test/.well-known/mta-sts.txt";
  const policy = "version: STSv1\r\nmode: testing\r\nmx: mx.example.test\r\nmax_age: 86400\r\n";
  assert.equal((await worker.dispatchFetch(policyUrl)).status, 404);
  await catalog.put("instance/transport/example.test.txt", policy);
  const served = await worker.dispatchFetch(policyUrl);
  assert.equal(served.status, 200);
  assert.equal(await served.text(), policy);
  assert.equal(
    (await worker.dispatchFetch("https://mta-sts.example.test/api/session")).status,
    404,
  );
  assert.equal((await worker.dispatchFetch(policyUrl, { method: "POST" })).status, 405);
  await catalog.put("instance/zone-catalog.json", JSON.stringify({ worker: "mail-fixture" }));
  const dnsResponse = await worker.dispatchFetch(
    "http://127.0.0.1/api/domains/domain-fixture/dns",
    { headers: { "Cf-Access-Jwt-Assertion": ownerJWT } },
  );
  assert.equal(dnsResponse.status, 200, await dnsResponse.clone().text());
  assert.deepEqual(await dnsResponse.json(), {
    apex: false,
    worker: "mail-fixture",
    progress: [
      {
        address: "push@example.test",
        inbound: "2026-11-20T12:04:00.000Z",
        outbound: null,
        captured: null,
        route: null,
      },
    ],
    domain: "example.test",
    state: "cutover",
    mx: ["10 before.example.test."],
    spf: [],
    dmarc: [],
  });
  for (const bad of [
    { aud: "another-app" },
    { iss: "https://other.test" },
    { exp: 1 },
    { type: "service" },
    { email: undefined },
    { sub: undefined },
    { exp: undefined },
  ])
    assert.equal((await call(bad)).status, 401);
  const other = await generateKeyPair("RS256");
  assert.equal((await call({}, other.privateKey)).status, 401);
  assert.equal((await call({}, new Uint8Array(32), "HS256")).status, 401);
  assert.equal(
    (
      await worker.dispatchFetch("http://127.0.0.1/app", {
        headers: { "Cf-Access-Authenticated-User-Email": claims.email },
      })
    ).status,
    401,
  );
  console.log(
    "PASS · production bundle checks signed Access assertions, JWKS outage, claims and algorithm; local identity binding is inert",
  );
} finally {
  await worker?.dispose();
  await rm(dir, { recursive: true, force: true });
}
