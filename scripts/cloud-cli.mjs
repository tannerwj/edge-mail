import { execFileSync } from "node:child_process";
export function cf(args, options = {}) {
  return execFileSync("./node_modules/.bin/cf", args, { encoding: "utf8", ...options });
}
export const api = (...args) => JSON.parse(cf(args));

export function activeBindings(worker) {
  const [deployment] = api(
    "workers",
    "deployments",
    "list",
    "--worker",
    worker,
    "--per-page",
    "1",
  ).deployments;
  if (deployment?.versions.length !== 1) throw Error("Finish the Worker rollout first");
  return api("workers", "versions", "get", deployment.versions[0].version_id, "--worker", worker)
    .bindings;
}

export function pages(args, size = 50) {
  const items = [];
  for (let page = 1; ; page++) {
    const rows = api(...args, "--page", String(page), "--per-page", String(size));
    if (!Array.isArray(rows)) throw Error("Unexpected Cloudflare listing");
    items.push(...rows);
    if (rows.length < size) return items;
  }
}
