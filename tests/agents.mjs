import { checkAgentDirectory } from "./agent-directory.mjs";
import { createHash } from "node:crypto";
import { runClaudeFixture } from "./claude-client.mjs";
import assert from "node:assert/strict";
export async function checkAgents({ page, origin, start, box, privateBox, root, json, sql }) {
  await start("owner@example.test");
  await page.goto(origin + "/settings/integrations");
  await page.getByText("Connected agents", { exact: true }).click();
  await page.getByLabel("Token name").fill("Personal filing agent");
  await page.getByLabel("Write mail", { exact: true }).check();
  await page.getByLabel("Administer instance").check();
  await page.getByLabel("All current and future mailboxes I can access").uncheck();
  await page.getByRole("checkbox", { name: "support@mail.test", exact: true }).check();
  await page.getByRole("button", { name: "Create API token" }).click();
  const raw = await page.getByLabel("New API token").inputValue();
  assert.ok(/^em_[\w-]{43}$/.test(raw));
  const call = (key, op, args = {}) =>
    fetch(origin + "/v1/" + op, {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: "Bearer " + key },
      body: JSON.stringify(args),
    });
  const read = async (key, op, args) => {
    const r = await call(key, op, args);
    assert.equal(r.status, 200, op + " " + (r.ok ? "" : await r.text()));
    return r.json();
  };
  const anonymous = await fetch(origin + "/v1/whoami");
  assert.equal(anonymous.status, 401);
  assert.ok(anonymous.headers.get("www-authenticate").includes("oauth-protected-resource"));
  assert.equal((await read(raw, "mailbox_list")).length, 1);
  assert.equal((await call(raw, "message_get", { mailbox: privateBox, id: root })).status, 403);
  const child = await read(raw, "token_create", {
    name: "Readonly child",
    boxes: [box],
    scopes: ["mail.read"],
    days: 90,
  });
  assert.equal(
    (
      await call(child.token, "message_triage", {
        mailbox: box,
        ids: [root],
        field: "starred",
        value: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(raw, "token_create", {
        name: "Too wide",
        boxes: null,
        scopes: ["mail.read"],
        days: 1,
      })
    ).status,
    403,
  );
  const ids = Array.from({ length: 200 }, (_, i) => "02" + String(i).padStart(24, "0"));
  sql(
    "INSERT INTO messages(id,mailbox_id,content_hash,wire_id,synthetic,sender,subject,snippet,body_key,received_at,attachment_count) SELECT value,'" +
      box +
      "',value,value,1,'bulk@example.test','Fixture','','none',CURRENT_TIMESTAMP,0 FROM json_each('" +
      JSON.stringify(ids) +
      "')",
  );
  const rpc = async (key, method, params) => {
    const response = await fetch(origin + "/mcp", {
      method: "POST",
      headers: { authorization: "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(!result.error, JSON.stringify(result.error));
    return result.result;
  };
  assert.equal(
    (await rpc(raw, "initialize", { protocolVersion: "2025-11-25" })).protocolVersion,
    "2025-11-25",
  );
  assert.deepEqual(
    (await rpc(raw, "tools/list", {})).tools.map((t) => t.name),
    ["search", "execute"],
  );
  const program = async (key, name, code, dry_run = false) => {
    const result = await rpc(key, "tools/call", { name, arguments: { code, dry_run } });
    assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
    return result.structuredContent;
  };
  assert.equal(
    (await program(child.token, "search", "async()=>operations.some(op=>op.write)")).result,
    false,
  );
  assert.equal(
    (await program(child.token, "execute", "async()=> (await mail.mailbox_list()).length")).result,
    1,
  );
  const args = { mailbox: box, ids, field: "folder", value: "archive" };
  const when = Date.now() + 3600000;
  const reply = {
    mailbox: box,
    message: root,
    body: "We received your library request.",
    idempotency_key: "library-agent-reply",
    scheduledFor: when,
  };
  const filing = {
    mailbox: box,
    revision: 0,
    document: {
      name: "File library notices",
      condition: { field: "from", op: "equals", value: "library@service.test" },
      actions: [{ kind: "label", value: "Library" }],
      order: 10,
      stop: false,
      enabled: true,
    },
  };
  const code =
    "async()=>({triage:await mail.message_triage(" +
    JSON.stringify(args) +
    "),reply:await mail.mail_reply(" +
    JSON.stringify(reply) +
    "),rule:await mail.rule_upsert(" +
    JSON.stringify(filing) +
    ")})";
  const plan = (await program(raw, "execute", code, true)).result;
  assert.equal(plan.triage.matched, 200);
  assert.equal(plan.reply.would_send, true);
  assert.equal((await read(raw, "audit_list", { mailbox: box })).length, 0);
  const actual =
    process.env.EDGE_MAIL_TEST_CLAUDE === "1"
      ? await runClaudeFixture(origin, raw, code)
      : await program(raw, "execute", code);
  assert.equal(actual.calls, 3);
  const receipt = actual.result.triage,
    job = actual.result.reply,
    rule = actual.result.rule;
  assert.equal(job.state, "held");
  assert.ok(rule.audit_id);
  assert.equal((await read(raw, "mail_reply", reply)).id, job.id);
  assert.equal((await call(raw, "mail_reply", { ...reply, body: "Conflict" })).status, 409);
  assert.equal((await read(raw, "audit_list", { mailbox: box })).length, 3);
  assert.equal(receipt.matched, 200);
  assert.ok(receipt.audit_id);
  assert.equal(
    sql("SELECT count(*) n FROM messages WHERE id LIKE '02%' AND folder='archive'")[0].n,
    200,
  );
  await json("/api/mailboxes/" + box + "/messages/" + ids[0], { field: "folder", value: "trash" });
  assert.equal((await call(raw, "audit_undo", { mailbox: box, id: receipt.audit_id })).status, 409);
  assert.equal(
    sql("SELECT count(*) n FROM messages WHERE id LIKE '02%' AND folder='archive'")[0].n,
    199,
  );
  await json("/api/mailboxes/" + box + "/messages/" + ids[0], {
    field: "folder",
    value: "archive",
  });
  assert.equal(
    (await read(raw, "audit_undo", { mailbox: box, id: receipt.audit_id })).matched,
    200,
  );
  assert.equal(
    sql("SELECT count(*) n FROM messages WHERE id LIKE '02%' AND folder='inbox'")[0].n,
    200,
  );
  const bytes = Buffer.from("Fictional pickup note."),
    sha = createHash("sha256").update(bytes).digest("hex");
  const argsUpload = { mailbox: box, name: "pickup.txt", size: bytes.length, sha256: sha };
  assert.equal((await call(child.token, "upload_create", argsUpload)).status, 403);
  const upload = await read(raw, "upload_create", argsUpload);
  const put = (body) => fetch(upload.url, { method: "PUT", body });
  const source = {
    ...reply,
    idempotency_key: "attachment-fixture",
    attachments: [{ upload_id: upload.upload_id }],
  };
  assert.equal((await call(raw, "mail_reply", { ...source, dry_run: true })).status, 409);
  assert.equal((await put(Buffer.from("short"))).status, 400);
  assert.equal((await put(bytes)).status, 200);
  const jobWithFile = await read(raw, "mail_reply", source);
  const file = JSON.parse(
    sql("SELECT letter FROM outbox WHERE id='" + jobWithFile.id + "'")[0].letter,
  ).files[0];
  assert.deepEqual(file, { id: sha, name: "pickup.txt", size: bytes.length });
  const original = sql(
    "SELECT id FROM messages WHERE mailbox_id='" +
      box +
      "' AND attachment_count>0 AND EXISTS(SELECT 1 FROM deliveries WHERE message_id=messages.id) LIMIT 1",
  )[0];
  assert.ok(original);
  const reused = await read(raw, "mail_reply", {
    ...source,
    idempotency_key: "reuse-part",
    attachments: [{ message_id: original.id, attachment_id: 0 }],
  });
  assert.ok(
    JSON.parse(sql("SELECT letter FROM outbox WHERE id='" + reused.id + "'")[0].letter).files[0]
      .size > 0,
  );
  if (process.env.EDGE_MAIL_NATIVE_PUSH === "1") {
    await page.context().grantPermissions(["notifications"], { origin });
    await page.getByText("Device notifications", { exact: true }).click();
    await page.getByLabel("Notify this device").selectOption("security");
    const feedback = page
      .getByText("Device notifications", { exact: true })
      .locator("..")
      .getByRole("status");
    await feedback.filter({ hasText: /./ }).waitFor({ timeout: 60000 });
    assert.equal(await feedback.textContent(), "Device preferences saved.");
  }
  const away = await read(raw, "rule_upsert", {
    ...filing,
    document: {
      ...filing.document,
      name: "Away for the afternoon",
      actions: [{ kind: "auto_reply", days: 2, text: "I will reply tomorrow." }],
    },
  });
  await page.reload();
  const banner = page.getByRole("region", { name: "Mail forwarding and security changes" });
  await banner.getByText("Mail egress changed").waitFor();
  if (process.env.EDGE_MAIL_NATIVE_PUSH === "1") {
    await page.waitForFunction(
      async () => {
        const r = await navigator.serviceWorker.ready;
        return (await r.getNotifications()).some(
          (n) => n.body === "A connected agent changed how mail leaves your mailbox.",
        );
      },
      undefined,
      { timeout: 60000 },
    );
    console.log("PASS · independently provisioned browser received native egress notification");
  }
  await banner.getByRole("button", { name: "Undo change" }).click();
  await banner.waitFor({ state: "hidden" });
  const restored = (await json("/api/mailboxes/" + box + "/rules")).find(
    (r) => r.rule_id === away.id,
  );
  assert.equal(restored.document.enabled, false);
  await page.getByText("Connected agents", { exact: true }).click();
  const pageOne = await read(raw, "changes_since", { mailbox: box });
  assert.ok(pageOne.changes.length > 0);
  assert.ok(pageOne.changes.every((r) => r.mailbox_id === box));
  const idle = await read(raw, "message_wait", {
    mailbox: box,
    filter: "from:never@absent.test",
    timeout: 0,
  });
  assert.equal(idle.message, null);
  const pending = read(raw, "message_wait", {
    mailbox: box,
    filter: "subject:Broadcast",
    cursor: idle.cursor,
    timeout: 10,
  });
  const rawMessage =
    "From: library@service.test\r\nTo: support@mail.test\r\nMessage-ID: <broadcast@service.test>\r\nSubject: Broadcast\r\n\r\nOpen hours.";
  assert.ok(
    (
      await fetch(
        origin + "/cdn-cgi/local/email?from=library%40service.test&to=support%40mail.test",
        { method: "POST", body: rawMessage },
      )
    ).ok,
  );
  assert.equal((await pending).message?.subject, "Broadcast");
  const mute = { mailbox: box, ids: [root], muted: true };
  assert.equal((await read(raw, "thread_mute", { ...mute, dry_run: true })).matched, 1);
  const timer = await read(raw, "thread_mute", mute);
  assert.equal((await read(raw, "audit_undo", { mailbox: box, id: timer.audit_id })).matched, 1);
  const stale = await read(raw, "thread_mute", mute);
  await json("/api/mailboxes/" + box + "/reminders", {
    action: "thread_mute",
    ids: [root],
    muted: false,
  });
  assert.equal((await call(raw, "audit_undo", { mailbox: box, id: stale.audit_id })).status, 409);
  await checkAgentDirectory({ read, call, json, raw, box, child });
  await page.getByRole("button", { name: "Revoke Personal filing agent" }).click();
  await page.getByText(/Access revoked, including child credentials/).waitFor();
  assert.equal((await call(child.token, "whoami")).status, 401);
  assert.equal((await call(raw, "whoami")).status, 401);
  assert.equal((await put(bytes)).status, 401);
  assert.equal(sql("SELECT state FROM outbox WHERE id='" + job.id + "'")[0].state, "cancelled");
  assert.equal(
    (await json("/api/mailboxes/" + box + "/rules")).find((r) => r.rule_id === rule.id).authorized,
    0,
  );
  await page.getByText("Agent activity", { exact: true }).click();
  await page.getByLabel("Activity mailbox").selectOption(box);
  await page.getByRole("button", { name: "Undo rule upsert" }).click();
  await page.getByText("Action undone.", { exact: true }).waitFor();
  assert.equal(
    (await json("/api/mailboxes/" + box + "/rules")).find((r) => r.rule_id === rule.id).document
      .enabled,
    false,
  );
  console.log(
    "PASS · private grant issuance, parent-child scope and mailbox narrowing, 200-message dry run, atomic triage and conflict-aware undo, revoke parent denies both tokens",
  );
}
