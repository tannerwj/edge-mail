import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const token = process.env.SETUP_TOKEN || randomBytes(32).toString("base64url");
const origin = "http://127.0.0.1:8787";
const child = spawn(
  "pnpm",
  [
    "exec",
    "wrangler",
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    "8787",
    "--define",
    "LOCAL_IDENTITY_ENABLED:true",
    "--var",
    "CONTENT_ORIGIN:http://localhost:8787",
    "--var",
    "DEV_IDENTITY:" + (process.env.DEV_IDENTITY || "owner@example.test"),
  ],
  { stdio: "inherit", env: { ...process.env, SETUP_TOKEN: token } },
);
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
if (!process.env.SETUP_TOKEN) {
  // The temporary local token stays in memory. Exercise the same first-run API as the UI.
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    const res = await fetch(origin + "/api/session").catch(() => null);
    if (!res?.ok) continue;
    if ((await res.json()).setup) {
      const saved = await fetch(origin + "/api/setup", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!saved.ok) throw new Error("Local owner bootstrap failed");
    }
    break;
  }
}
