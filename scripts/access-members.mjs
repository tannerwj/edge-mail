import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { activeBindings, api, cf } from "./cloud-cli.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { check: { type: "boolean" }, apply: { type: "boolean" }, remove: { type: "boolean" } },
});
const [worker, input] = positionals,
  email = (input || "").toLowerCase();
assert.ok(
  positionals.length === 2 &&
    /^edge-mail-[0-9a-f]{12}$/.test(worker) &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) &&
    !!values.check !== !!values.apply,
  "Choose --check or --apply, followed by the installed Worker name and one exact sign-in email",
);
const record = JSON.parse(readFileSync(".wrangler/instances/" + worker + ".json", "utf8"));
assert.equal(record.name, worker);
assert.deepEqual(
  api("auth", "whoami").accounts.map((a) => a.id),
  [record.account],
);
const db = activeBindings(worker).find((b) => b.name === "DB" && b.type === "d1")?.id;
assert.ok(db);
const app = api("zero-trust", "access", "applications", "list").find(
  (a) => a.domain === record.host && a.name === "Edge Mail owner (" + record.host + ")",
);
assert.ok(app?.id, "Missing installer-managed Access application");
const args = ["zero-trust", "access", "applications"],
  get = () => api(...args, "get", app.id);
const current = get();
assert.equal(current.destinations.length, 1);
assert.equal(current.destinations[0].uri, record.host);
assert.equal(current.policies.length, 1, "Review custom policy ordering in Cloudflare Access");
const [p] = current.policies;
assert.ok(
  p.name === "Installation owner" &&
    !p.reusable &&
    p.decision === "allow" &&
    !p.exclude.length &&
    !p.require.length &&
    p.include.every((r) => Object.keys(r).length === 1 && r.email?.email),
  "This command manages the installer's exact-email allow list",
);
const alphabetical = (a, b) => a.localeCompare(b);
const members = new Set(p.include.map((r) => r.email.email.toLowerCase()));
assert.ok(members.has(record.owner));
if (values.remove && email === record.owner) throw Error("Keep the installation owner admitted");
if (!values.remove && email !== record.owner) {
  const enabled = api(
    "d1",
    "query",
    db,
    "--body",
    JSON.stringify({
      sql: "SELECT 1 FROM users u JOIN user_emails e ON e.user_id=u.id WHERE e.email=? AND u.disabled_at IS NULL",
      params: [email],
    }),
  )[0].results;
  assert.equal(enabled.length, 1, "Save the person's sign-in address in Edge Mail first");
}
if (members.has(email) !== !!values.remove)
  console.log("The exact-email policy already matches the request.");
else {
  if (values.remove) members.delete(email);
  else members.add(email);
  const body = {
    ...current,
    policies: [
      {
        id: p.id,
        name: p.name,
        decision: p.decision,
        precedence: p.precedence,
        exclude: p.exclude,
        require: p.require,
        include: [...members].sort(alphabetical).map((value) => ({ email: { email: value } })),
      },
    ],
  };
  for (const field of ["id", "uid", "aud", "created_at", "updated_at", "self_hosted_domains"])
    delete body[field];
  const update = [...args, "update", app.id, "--body", JSON.stringify(body)];
  cf([...update, "--dry-run"]);
  console.log((values.remove ? "Remove " : "Admit ") + email + " for " + record.host);
  if (values.apply) {
    assert.deepEqual(
      get(),
      current,
      "Access changed after preview. Repeat with the current policy.",
    );
    cf(update);
    const after = get();
    assert.equal(after.aud, current.aud);
    assert.deepEqual(after.destinations, current.destinations);
    assert.deepEqual(
      after.policies[0].include.map((r) => r.email.email.toLowerCase()).sort(alphabetical),
      [...members].sort(alphabetical),
    );
    console.log("Verified the updated Access list.");
  }
}
