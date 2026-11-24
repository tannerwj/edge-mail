import assert from "node:assert/strict";
export async function checkAgentDirectory({ read, call, json, raw, box, child }) {
  assert.ok((await read(raw, "token_list", {})).some((g) => g.id === child.id));
  assert.equal((await call(raw, "user_list", {})).status, 403);
  assert.equal((await call(raw, "domain_add", { name: "blocked.test" })).status, 403);
  const full = await json("/api/grants", {
    name: "Directory operator",
    boxes: null,
    scopes: ["admin"],
    days: 1,
  });
  const restricted = await json("/api/grants", {
    name: "Restricted directory",
    boxes: null,
    scopes: ["admin"],
    days: 1,
    policy: { review_egress: true },
  });
  assert.equal(
    (await call(restricted.token, "user_add", { email: "blocked@fiction.test" })).status,
    403,
  );
  assert.equal((await call(raw, "token_revoke", { id: full.id })).status, 404);
  const temp = await read(raw, "token_create", {
    name: "Temporary reader",
    boxes: [box],
    scopes: ["mail.read"],
    days: 1,
  });
  await read(raw, "token_revoke", { id: temp.id });
  assert.equal((await call(temp.token, "whoami", {})).status, 401);
  for (const [name, args] of [
    ["domain_add", { name: "directory.test" }],
    ["user_add", { email: "clerk@fiction.test" }],
    ["mailbox_create", { name: "Clerk", address: "clerk@directory.test" }],
  ]) {
    assert.ok((await read(full.token, name, { ...args, dry_run: true })).would_create);
    assert.ok((await read(full.token, name, args)).id);
  }
  assert.ok((await read(full.token, "domain_list", {})).some((d) => d.name === "directory.test"));
  assert.ok(
    (await read(full.token, "user_list", {})).some((u) => u.emails.includes("clerk@fiction.test")),
  );
  assert.ok((await read(full.token, "settings_get", {})).policy);
  const params = { mailbox: box, address: "desk@fiction.test" };
  assert.equal(
    (await read(restricted.token, "egress_destination_add", { ...params, dry_run: true }))
      .would_hold,
    true,
  );
  const held = await read(restricted.token, "egress_destination_add", params);
  assert.equal(held.state, "pending");
  assert.ok(
    !(await read(raw, "egress_destination_list", { mailbox: box })).some(
      (d) => d.address === params.address,
    ),
  );
  await json("/api/approvals/" + held.approval_id, { approve: true });
  const dest = (await read(raw, "egress_destination_list", { mailbox: box })).find(
    (d) => d.address === params.address,
  );
  assert.ok(dest);
  assert.equal(dest.verified_at, null);
  assert.ok((await json("/api/notices")).some((n) => n.name === "Restricted directory"));
  console.log(
    "PASS · scoped agent cannot list the instance or revoke a sibling, an administrator creates a domain, mailbox and member, and human approval registers an unverified destination and notifies its owner",
  );
}
