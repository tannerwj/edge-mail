import assert from "node:assert/strict";
import { api, pages } from "./cloud-cli.mjs";
export function oauthNamespace(name, apply, managed = true) {
  const title = name + "-oauth";
  const ns = pages(["kv", "namespaces", "list"]).filter((v) => v.title === title);
  assert.ok(
    ns.length <= 1 && (!ns.length || managed),
    "OAuth storage name already belongs to another installation",
  );
  if (ns.length) return ns[0].id;
  const args = ["kv", "namespaces", "create", "--title", title];
  api(...args, "--dry-run");
  return apply ? api(...args).id : "0".repeat(32);
}
