import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

export async function checkRules({ page, origin, json, request, start, box, privateBox }) {
  const path = "/api/mailboxes/" + box,
    rules = path + "/rules";
  const doc = {
    name: "File invoices",
    enabled: true,
    order: 20,
    stop: true,
    condition: {
      all: [
        { field: "from", op: "equals", value: "billing@store.test" },
        { field: "subject", op: "matches", value: "^Invoice [0-9]+$" },
      ],
    },
    actions: [{ kind: "label", value: "Invoices" }, { kind: "archive" }],
  };
  const save = { scope: "mailbox", revision: 0, document: doc };
  await start("reader@example.test");
  assert.equal((await request(rules, save)).status, 403);
  await start("box-editor@example.test");
  assert.equal((await request(rules, { ...save, scope: "instance" })).status, 403);
  assert.equal((await request("/api/mailboxes/" + privateBox + "/rules", save)).status, 403);
  await page.goto(origin + "/settings/mail");
  await page.getByText("Mail rules", { exact: true }).click();
  await page.getByLabel("Rules for mailbox").selectOption(box);
  await page.getByLabel("Rule name").fill("Mark vendor notices");
  await page.getByLabel("Match value").fill("billing@store.test");
  await page.getByLabel("Rule label").fill("Later rule");
  await page.getByRole("button", { name: "Preview recent matches" }).click();
  await page.getByText(/Matched 0 of/).waitFor();
  assert.equal((await json(rules)).length, 0);
  await page.getByRole("button", { name: "Save rule" }).click();
  await page.getByText("Rule saved.").waitFor();
  const first = await json(rules, save);
  const selected = rules + "/" + first.id;
  const raw = [
    "From: billing@store.test",
    "To: support@mail.test",
    "Subject: Invoice 741",
    "Message-ID: <rules-741@store.test>",
    "",
    "Order total is 12.",
  ].join("\r\n");
  for (const address of ["support@mail.test", "orders@mail.test"]) {
    assert.ok(
      (
        await fetch(
          origin +
            "/cdn-cgi/local/email?" +
            new URLSearchParams({ from: "billing@store.test", to: address }),
          { method: "POST", body: raw },
        )
      ).ok,
    );
  }
  let item;
  for (let i = 0; i < 50 && !item; i++) {
    item = (await json(path + "/messages?q=" + encodeURIComponent("in:archive label:Invoices")))
      .messages[0];
    if (!item) await sleep(200);
  }
  assert.ok(item, "The first matching rule archived and labelled incoming mail");
  const result = await json(path + "/messages/" + item.id);
  assert.deepEqual(result.labels, ["Invoices"]);
  assert.equal((await json(selected)).runs.length, 1);
  const revision = await json(selected, { revision: 1, document: { ...doc, enabled: false } });
  assert.equal(revision.revision, 2);
  assert.equal((await request(selected, { revision: 1, restore: 1 })).status, 409);
  await page.reload();
  await page.getByText("Mail rules", { exact: true }).click();
  await page.getByLabel("Rules for mailbox").selectOption(box);
  await page.getByRole("button", { name: "Manage File invoices" }).click();
  await page.getByRole("button", { name: "Restore version 1" }).click();
  await page.getByText(/File invoices · mailbox · version 3/).waitFor();
  const preview = await json(selected, { action: "apply_existing", revision: 3, dry_run: true });
  assert.ok(preview.matches.some((m) => m.id === item.id));
  await json(path + "/messages/" + item.id, { field: "folder", value: "inbox" });
  await json(selected, { action: "apply_existing", revision: 3 });
  assert.equal(
    (await json(path + "/messages/" + item.id)).folder,
    "inbox",
    "Replaying a run preserves later human triage",
  );
  await start("reader@example.test");
  await page.goto(origin + "/mailboxes/" + box + "/inbox/messages/" + item.id);
  await page.getByText("Message tools & details", { exact: true }).click();
  await page.getByText("Why is this here?", { exact: true }).click();
  await page.getByText("File invoices · mailbox rule · version 1", { exact: false }).waitFor();
  await page.getByText("Matched orders@mail.test · alias", { exact: false }).waitFor();
  assert.ok((await json(rules)).some((r) => r.rule_id === first.id));
  assert.equal((await request(selected, { revision: 3, restore: 1 })).status, 403);
  console.log(
    "PASS · rule preview, sender and pattern conditions, ordered stop, alias deduplication, version restore, replay and reader permissions",
  );
}
