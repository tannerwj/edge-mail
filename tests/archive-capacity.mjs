import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Produce an independent mbox export with the Python standard library, then exercise the browser importer.
const writer = `
import email.message, mailbox, sys
box=mailbox.mbox(sys.argv[1])
for n in range(int(sys.argv[2])):
    msg=email.message.EmailMessage()
    msg['From']='dispatch@parcel.example'
    msg['To']='archive-capacity@mail.test'
    msg['Message-ID']=f'<parcel-{n}@parcel.example>'
    msg['Date']='Thu, 7 May 2020 12:00:00 +0000'
    msg['Subject']=f'Dispatch receipt {n}'
    msg.set_content(f'Parcel {n} arrived at the depot.\\n' + 'Shipping detail. ' * 80)
    box.add(msg)
box.close()
`;
export async function archiveCapacity({ page, origin, json, sql }) {
  const n = Number(process.env.EDGE_MAIL_ARCHIVE_COUNT || 0);
  if (!n) return;
  assert.ok(Number.isSafeInteger(n) && n >= 1 && n <= 50000, "Choose 1–50,000 synthetic messages");
  const { id } = await json("/api/mailboxes", {
    name: "Archived dispatches",
    address: "archive-capacity@mail.test",
  });
  const dir = await mkdtemp(join(tmpdir(), "edge-archive-capacity-"));
  const bytes = async () => (await json("/api/operations")).databaseBytes;
  try {
    const file = join(dir, "Archive.mbox");
    execFileSync("python3", ["-c", writer, file, String(n)]);
    const before = await bytes();
    await page.goto(origin + "/settings/data");
    await page.getByText("Import and export mail", { exact: true }).click();
    await page.getByLabel("Archive mailbox").selectOption(id);
    await page.getByLabel("Import an mbox file").setInputFiles(file);
    const start = Date.now();
    await page.getByRole("button", { name: "Import messages" }).click();
    await page
      .getByText("Import complete · " + n + " messages", { exact: true })
      .waitFor({ timeout: Math.max(60000, n * 2000) });
    const elapsed = Date.now() - start;
    assert.equal(sql("SELECT count(*) n FROM messages WHERE mailbox_id='" + id + "'")[0].n, n);
    const times = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      const found = await json("/api/mailboxes/" + id + "/messages?q=subject%3ADispatch");
      times.push(performance.now() - t);
      assert.equal(found.messages.length, Math.min(n, 50));
    }
    times.sort((a, b) => a - b);
    console.log(
      "Archive capacity",
      JSON.stringify({
        messages: n,
        import_ms: elapsed,
        db_growth_bytes: (await bytes()) - before,
        search_p95_ms: Math.round(times[18]),
        environment: "local Wrangler, HTTP search, warm D1",
      }),
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}
