import { archiveCapacity } from "./archive-capacity.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { archiveEntries } from "../web/mbox.ts";
const wire = (id) =>
  "From: receipt@fiction.test\r\nTo: archive-trial@mail.test\r\nSubject: Historic parcel " +
  id +
  "\r\nDate: Thu, 7 May 2020 12:00:00 +0000\r\nMessage-ID: <past-" +
  id +
  "@fiction.test>\r\nX-Mozilla-Status: 0001\r\n\r\nBlue order " +
  id +
  "\r\n";
export async function checkPortability({ page, origin, start, json, request, sql }) {
  await start("owner@example.test");
  const { id: box } = await json("/api/mailboxes", {
    name: "Archive trial",
    address: "archive-trial@mail.test",
  });
  const path = "/api/mailboxes/" + box;
  await json(path + "/rules", {
    scope: "mailbox",
    revision: 0,
    document: {
      name: "Mark arriving receipts",
      condition: { field: "from", op: "equals", value: "receipt@fiction.test" },
      actions: [{ kind: "label", value: "New arrivals" }],
      order: 1,
      stop: false,
      enabled: true,
    },
  });
  const separator = "From receipt@fiction.test Thu May  7 12:00:00 2020\n";
  const bytes = Buffer.from(separator + wire(1) + "\n" + separator + wire(2) + "\n");
  await page.goto(origin + "/settings/data");
  await page.getByText("Import and export mail", { exact: true }).click();
  await page.getByLabel("Archive mailbox").selectOption(box);
  await page
    .getByLabel("Import an mbox file")
    .setInputFiles({ name: "Inbox.mbox", mimeType: "application/mbox", buffer: bytes });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Import messages" }).click();
    await page.getByText("Import complete · 2 messages", { exact: true }).waitFor();
  }
  const hits = (await json(path + "/messages?q=subject%3AHistoric")).messages;
  assert.equal(hits.length, 2);
  assert.equal(hits[0].received_at, "2020-05-07T12:00:00.000Z");
  assert.deepEqual((await json(path + "/messages/" + hits[0].id)).labels, []);
  await json(path + "/messages/" + hits[0].id, { field: "label", value: "Keepsake" });
  assert.equal(
    sql("SELECT count(*) n FROM deliveries WHERE mailbox_id='" + box + "' AND kind='import'")[0].n,
    2,
  );
  await page.evaluate(() => {
    Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
  });
  async function download(label) {
    const ready = page.waitForEvent("download");
    await page.getByRole("button", { name: label }).click();
    const file = await ready;
    return readFile(await file.path());
  }
  const zip = unzipSync(await download("Export originals, labels and rules (.zip)"));
  assert.ok(Object.keys(zip).includes("messages/" + hits[0].id + ".eml"));
  const originals = Object.entries(zip)
    .filter(([name]) => name.endsWith(".eml"))
    .map(([, data]) => Buffer.from(data).toString())
    .sort();
  assert.deepEqual(originals, [wire(1), wire(2)]);
  assert.ok(
    JSON.parse(Buffer.from(zip["metadata/messages-0.json"])).some((m) =>
      m.labels.includes("Keepsake"),
    ),
  );
  assert.equal(
    JSON.parse(Buffer.from(zip["metadata/rules.json"])).some(
      (r) => r.document.name === "Mark arriving receipts",
    ),
    true,
  );
  const records = await Array.fromAsync(archiveEntries(new Blob([await download("Export mbox")])));
  assert.deepEqual((await Promise.all(records.map((r) => r.body.text()))).sort(), originals);
  await archiveCapacity({ page, origin, json, sql });
  await start("reader@example.test");
  assert.equal((await request(path + "/archive")).status, 403);
  console.log(
    "PASS · mailbox owner imports and retries a historical mbox, searches original dates, exports exact EML, labels and rules, and history does not run arrival actions",
  );
}
