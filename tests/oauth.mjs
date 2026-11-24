import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
export async function checkOAuth({ origin, page, start, box, mailboxLabel = "support@mail.test" }) {
  await start("owner@example.test");
  const callback = createServer((_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.end("Connection received");
  });
  callback.listen(0, "127.0.0.1");
  await once(callback, "listening");
  const redirect = "http://127.0.0.1:" + callback.address().port + "/connected";
  try {
    const metadata = await fetch(origin + "/.well-known/oauth-authorization-server").then((r) =>
      r.json(),
    );
    assert.equal(metadata.issuer, origin);
    assert.ok(metadata.code_challenge_methods_supported.includes("S256"));
    const registered = await fetch(metadata.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Mail filing assistant",
        redirect_uris: [redirect],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(registered.status, 201);
    const { client_id } = await registered.json();
    const token = (args) =>
      fetch(metadata.token_endpoint, {
        method: "POST",
        body: new URLSearchParams({ client_id, ...args }),
      });
    const who = (key) =>
      fetch(origin + "/v1/whoami", {
        method: "POST",
        headers: { authorization: "Bearer " + key, "content-type": "application/json" },
        body: "{}",
      });
    async function authorize() {
      const verifier = randomBytes(40).toString("base64url"),
        challenge = createHash("sha256").update(verifier).digest("base64url");
      const state = randomBytes(12).toString("hex");
      const u = new URL(metadata.authorization_endpoint);
      u.search = new URLSearchParams({
        client_id,
        redirect_uri: redirect,
        response_type: "code",
        state,
        scope: "mail.read",
        resource: origin + "/mcp",
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      await page.goto(String(u));
      await page.getByRole("heading", { name: "Mail filing assistant" }).waitFor();
      await page.getByLabel("All mailboxes I can access").uncheck();
      await page.getByLabel(mailboxLabel, { exact: true }).check();
      await page.getByLabel("Grant duration in days").fill("1");
      await page.getByRole("button", { name: "Approve connection" }).click();
      await page.waitForURL((location) => location.origin === new URL(redirect).origin);
      const params = new URL(page.url()).searchParams;
      assert.equal(params.get("state"), state);
      assert.equal(params.get("iss"), origin);
      return {
        grant_type: "authorization_code",
        code: params.get("code"),
        redirect_uri: redirect,
        resource: origin + "/mcp",
        code_verifier: verifier,
      };
    }
    const req = await authorize();
    assert.equal((await token({ ...req, code_verifier: "x".repeat(56) })).status, 400);
    const r = await token(req);
    assert.equal(r.status, 200, "Correct PKCE verifier exchanges the code");
    const pair = await r.json();
    assert.equal(pair.expires_in, 900);
    assert.ok(pair.refresh_token);
    const auth = await who(pair.access_token);
    assert.equal(auth.status, 200);
    const me = await auth.json();
    assert.deepEqual(me.boxes, [box]);
    assert.deepEqual(me.scopes, ["mail.read"]);
    const refresh = {
      grant_type: "refresh_token",
      refresh_token: pair.refresh_token,
      resource: origin + "/mcp",
    };
    const rotated = await token(refresh);
    assert.equal(rotated.status, 200);
    const next = await rotated.json();
    assert.ok(next.refresh_token !== pair.refresh_token);
    assert.equal((await token(refresh)).status, 400);
    assert.equal((await who(next.access_token)).status, 401);
    const second = await (await token(await authorize())).json();
    assert.equal((await who(second.access_token)).status, 200);
    assert.equal(
      (await token({ token: second.refresh_token, token_type_hint: "refresh_token" })).status,
      200,
    );
    assert.equal((await who(second.access_token)).status, 401);
    console.log(
      "PASS · third-party client registers, owner consents to one mailbox, S256, issuer, 15-minute access, refresh rotation and reuse, family revocation",
    );
  } finally {
    callback.close();
    callback.closeAllConnections();
  }
}
