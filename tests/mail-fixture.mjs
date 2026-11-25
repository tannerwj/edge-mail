import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export async function mailFixture() {
  const state = await mkdtemp(join(tmpdir(), "edge-mail-e2e-"));
  const portFinder = createServer();
  portFinder.listen(0, "127.0.0.1");
  await once(portFinder, "listening");
  const port = portFinder.address().port;
  await new Promise((done) => portFinder.close(done));
  const origin = "http://127.0.0.1:" + port,
    token = randomBytes(32).toString("base64url");
  const env = { ...process.env, SETUP_TOKEN: token, WRANGLER_SEND_METRICS: "false", CI: "1" };
  const cli = "./node_modules/.bin/wrangler";
  let child;
  function wrangler(args) {
    return execFileSync(cli, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  }
  function sql(statement) {
    return JSON.parse(
      wrangler([
        "d1",
        "execute",
        "DB",
        "--local",
        "--persist-to",
        state,
        "--json",
        "--command",
        statement,
      ]),
    )[0].results;
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const finished = once(child, "exit");
    process.kill(-child.pid, "SIGTERM");
    await finished;
    child = null;
  }
  async function start(identity, fault = false) {
    await stop();
    const args = [
      "dev",
      ...(fault ? ["tests/fault-worker.ts"] : []),
      "--local",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--persist-to",
      state,
      "--test-scheduled",
      "--var",
      "CONTENT_ORIGIN:http://localhost:" + port,
    ];
    if (identity)
      args.push(
        "--define",
        "LOCAL_IDENTITY_ENABLED:true",
        "--var",
        "DEV_IDENTITY:" + identity,
        "--var",
        "PROBE_MODE:capture",
        "--var",
        "ACCESS_TEAM_DOMAIN:fixture.cloudflareaccess.com",
        "--var",
        "ACCESS_AUD:fixture",
      );
    child = spawn(cli, args, { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let logs = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        logs = (logs + chunk).slice(-5000);
      });
    for (let tries = 0; tries < 120; tries++) {
      if (child.exitCode !== null)
        throw Error("Worker failed to start: " + logs.replaceAll(token, "[redacted]"));
      if (
        await fetch(origin + "/healthz").then(
          () => true,
          () => false,
        )
      )
        return;
      await sleep(100);
    }
    throw Error("Worker startup timed out");
  }
  const request = (path, data) =>
    fetch(
      origin + path,
      data
        ? {
            method: "POST",
            headers: { Origin: origin, "Content-Type": "application/json" },
            body: JSON.stringify(data),
          }
        : {},
    );
  async function json(path, data) {
    const r = await request(path, data);
    assert.ok(r.ok, path + " " + r.status + " " + (!r.ok ? await r.text() : ""));
    return r.json();
  }
  return {
    origin,
    token,
    wrangler,
    sql,
    start,
    state,
    request,
    json,
    close: async () => {
      await stop();
      await rm(state, { recursive: true, force: true });
    },
  };
}
