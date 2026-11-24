import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import { sample } from "./dmarc-sample.mjs";
export async function checkReports({ start, json, request, page, origin, box }) {
  await start("owner@example.test");
  const route = "/api/mailboxes/" + box + "/reports",
    mailbox = (await json("/api/workspace")).mailboxes.find((b) => b.id === box).address;
  await page.goto(origin + "/settings/operations");
  await page.getByText("DMARC aggregate reports", { exact: true }).click();
  await page.getByLabel("Reporting mailbox", { exact: true }).selectOption(box);
  const saved = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === route,
  );
  await page.getByRole("button", { name: "Start collecting reports" }).click();
  const change = await saved;
  assert.equal(change.status(), 200, await change.text());
  await page.getByRole("button", { name: "Stop collecting reports" }).waitFor();
  assert.equal((await json(route)).enabled, true);
  async function receipt(mark, xml, auth) {
    const from = "reports@receiver.test";
    const raw = [
      "Authentication-Results: mx.cloudflare.net; dmarc=" + auth,
      "From: " + from,
      "To: " + mailbox,
      "Subject: Aggregate proof " + mark,
      "Message-ID: <" + mark + "@reports.test>",
      "MIME-Version: 1.0",
      "Content-Type: multipart/mixed; boundary=entry",
      "",
      "--entry",
      "Content-Type: text/plain",
      "",
      "Fictional aggregate notification.",
      "--entry",
      "Content-Type: application/gzip",
      "Content-Disposition: attachment; filename=report.xml.gz",
      "Content-Transfer-Encoding: base64",
      "",
      gzipSync(xml).toString("base64"),
      "--entry--",
      "",
    ].join("\r\n");
    assert.ok(
      (
        await fetch(origin + "/cdn-cgi/local/email?" + new URLSearchParams({ from, to: mailbox }), {
          method: "POST",
          body: raw,
        })
      ).ok,
    );
  }
  await receipt("unauth-report", sample.replace("report-26", "report-other"), "fail");
  await receipt("foreign-report", sample.replace("mail.test", "other.test"), "pass");
  await receipt("real-report", sample, "pass");
  await receipt("duplicate-report", sample, "pass");
  for (let i = 0; i < 80 && !(await json(route)).reports.length; i++) await sleep(100);
  const reports = (await json(route)).reports;
  assert.equal(reports.length, 1);
  assert.deepEqual(
    [reports[0].total, reports[0].aligned, reports[0].rejected, reports[0].reporter],
    [15, 12, 3, "receiver.test"],
  );
  await page.reload();
  await page.getByText("DMARC aggregate reports", { exact: true }).click();
  await page.getByLabel("Reporting mailbox", { exact: true }).selectOption(box);
  await page.getByText("12 of 15 aligned · 3 rejected · 0 quarantined").waitFor();
  await start("reader@example.test");
  assert.equal((await request(route)).status, 403);
  console.log(
    "PASS · owner collects compressed aggregate reports in a designated mailbox, reviews the count and avoids duplicate, foreign-domain and unauthenticated reports",
  );
}
