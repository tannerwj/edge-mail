import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cf } from "./cloud-cli.mjs";
// Record the last successful rule readback. DNS and delivery observations are tracked separately.
export function recordRoutes(bucket, domain, kind, addresses) {
  const dir = mkdtempSync(join(tmpdir(), "edge-mail-routes-"));
  try {
    const path = join(dir, "routes.json");
    writeFileSync(path, JSON.stringify({ checked: new Date().toISOString(), addresses }), {
      mode: 0o600,
    });
    const put = [
      "r2",
      "objects",
      "put",
      "instance/routes/" + domain + "/" + kind + ".json",
      "--bucket-name",
      bucket,
      "--file",
      path,
      "--content-type",
      "application/json",
    ];
    cf([...put, "--dry-run"]);
    cf(put);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
