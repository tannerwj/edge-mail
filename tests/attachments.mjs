import { setTimeout as sleep } from "node:timers/promises";
import PostalMime from "postal-mime";
import assert from "node:assert/strict";
export async function checkAttachments({ start, json, origin, box, sql, browser }) {
  const email = "download@example.test";
  await start("owner@example.test");
  await json("/api/users", { email });
  await json("/api/mailboxes/" + box + "/members", { email, role: "reader" });
  const mime = [
    "Authentication-Results: mx.cloudflare.net; dmarc=pass",
    "From: customer@outside.test",
    "To: support@mail.test",
    "Subject: Attachment journey",
    "Message-ID: <attached@outside.test>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="testing"',
    "",
    "--testing",
    "Content-Type: text/html; charset=utf-8",
    "",
    'Please see the <strong>formatted note</strong>. <a href="https://example.test/orders">Order</a><img src="https://tracker.invalid/image">',
    "--testing",
    "Content-Type: application/octet-stream",
    'Content-Disposition: attachment; filename="receipt.txt"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("Order received.\n").toString("base64"),
    "--testing",
    "Content-Type: text/calendar; method=REQUEST",
    'Content-Disposition: attachment; filename="window.ics"',
    "",
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fixture//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:local",
    "SEQUENCE:4",
    "ORGANIZER:mailto:appointments@fiction.test",
    "ATTENDEE;RSVP=TRUE:mailto:support@mail.test",
    "DTSTAMP:20261124T120000Z",
    "DTSTART;TZID=America/Denver:20261130T100000",
    "DTEND;TZID=America/Denver:20261130T103000",
    "SUMMARY:Pickup window for",
    "  the order",
    "LOCATION:Customer desk",
    "RRULE:FREQ=WEEKLY",
    "END:VEVENT",
    "END:VCALENDAR",
    "--testing",
    "Content-Type: image/png",
    'Content-Disposition: attachment; filename="sample.png"',
    "Content-Transfer-Encoding: base64",
    "",
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6P8AAAAAASUVORK5CYII=",
    "--testing",
    "Content-Type: application/pdf",
    'Content-Disposition: attachment; filename="note.pdf"',
    "",
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj",
    "trailer<</Root 1 0 R>>",
    "%%EOF",
    "--testing--",
    "",
  ].join("\r\n");
  const accepted = await fetch(
    origin + "/cdn-cgi/local/email?from=customer%40outside.test&to=support%40mail.test",
    { method: "POST", body: mime },
  );
  assert.ok(accepted.ok);
  await start(email);
  const page = await browser.newPage();
  try {
    await page.goto(origin + "/mailboxes/" + box + "/inbox");
    await page.getByRole("link", { name: /Attachment journey/ }).click();
    await page.getByRole("button", { name: "Show formatted message" }).click();
    const frame = page.frameLocator('iframe[title="Formatted message"]');
    await frame.locator("strong", { hasText: "formatted note" }).waitFor();
    assert.equal(await frame.locator("img,form,style[nonce]").count(), 0);
    assert.equal(
      await page.locator('iframe[title="Formatted message"]').getAttribute("sandbox"),
      "allow-scripts",
    );
    await page.route("**/img/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6P8AAAAAASUVORK5CYII=",
          "base64",
        ),
      }),
    );
    await page.getByRole("button", { name: "Load images for this message" }).click();
    const img = frame.locator("img");
    await img.waitFor();
    assert.match(await img.getAttribute("src"), /^http:\/\/localhost:\d+\/img\//);
    await page.getByRole("button", { name: "Always show images from this sender" }).click();
    await page.getByRole("button", { name: "Stop showing this sender’s images" }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Show formatted message" }).click();
    await img.waitFor();
    await page.getByRole("button", { name: "Stop showing this sender’s images" }).click();
    await page.getByRole("button", { name: "Load images for this message" }).waitFor();
    await frame.locator("strong", { hasText: "formatted note" }).waitFor();
    await frame.getByRole("link", { name: "Order" }).click();
    await page.getByRole("link", { name: "https://example.test/orders", exact: true }).waitFor();
    await page.getByRole("button", { name: "Show plain text" }).click();
    await page.getByText("Attachments · 4", { exact: true }).click();
    await page.getByText("Calendar invitation", { exact: true }).click();
    await page.getByRole("heading", { name: "Pickup window for the order" }).waitFor();
    await page.getByText("Starts 2026-11-30 10:00:00 America/Denver", { exact: true }).waitFor();
    await page.getByText("Recurring event", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Review calendar reply" }).count(), 0);
    const received = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download receipt.txt" }).click();
    const download = await received;
    assert.equal(download.suggestedFilename(), "receipt.txt");
    const id = new URL(page.url()).pathname.split("/").at(-1);
    await page.getByText("Preview sample.png", { exact: true }).click();
    const previewLink = page.getByRole("link", { name: "Open sample.png in a new tab" });
    const opened = page.waitForEvent("popup");
    await previewLink.click();
    const imageTab = await opened;
    await imageTab.locator("img").waitFor();
    assert.equal(await imageTab.locator("img").evaluate((el) => el.naturalWidth), 1);
    await imageTab.close();
    const previewBase = "/api/mailboxes/" + box + "/preview/" + id + "?part=";
    const { href: pdf } = await json(previewBase + 3);
    const pdfResponse = await fetch(pdf);
    assert.equal(pdfResponse.headers.get("content-type"), "application/pdf");
    assert.equal(pdfResponse.headers.get("content-disposition"), "inline");
    assert.match(await pdfResponse.text(), /^%PDF-1.4/);
    assert.equal((await fetch(origin + previewBase + 0)).status, 404);
    const route = "/api/mailboxes/" + box + "/attachments/" + id + "?part=0";
    const { href } = await json(route);
    const { href: formatted } = await json("/api/mailboxes/" + box + "/formatted/" + id);
    assert.equal((await fetch(formatted.replace("/html/", "/file/"))).status, 404);
    const response = await fetch(href);
    assert.equal(await response.text(), "Order received.\n");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.ok(response.headers.get("Content-Security-Policy").includes("sandbox"));
    assert.equal((await fetch(new URL("/api/session", href))).status, 404);
    const token = new URL(href);
    token.pathname = token.pathname.replace("/file/", "/file/x");
    assert.equal((await fetch(token)).status, 404);
    for (const [subject, opening, indicator] of [
      ["Signature example", "-----BEGIN PGP SIGNED MESSAGE-----", "Signed (not verified)"],
      ["Encrypted example", "-----BEGIN PGP MESSAGE-----", "Encrypted, not supported"],
    ]) {
      const raw = [
        "From: customer@outside.test",
        "To: support@mail.test",
        "Message-ID: <" + subject.split(" ")[0] + "@outside.test>",
        "Subject: " + subject,
        "Content-Type: text/plain",
        "",
        opening,
        "",
        "Fictional protected content.",
      ].join("\r\n");
      const sent = await fetch(
        origin + "/cdn-cgi/local/email?from=customer%40outside.test&to=support%40mail.test",
        { method: "POST", body: raw },
      );
      assert.ok(sent.ok);
      await page.goto(origin + "/mailboxes/" + box + "/inbox");
      await page.getByRole("link", { name: new RegExp(subject) }).click();
      await page.getByText(indicator, { exact: true }).waitFor();
    }
    sql(
      "DELETE FROM mailbox_members WHERE user_id=(SELECT user_id FROM user_emails WHERE email='download@example.test')",
    );
    assert.equal((await fetch(href)).status, 404);
    assert.equal((await fetch(pdf)).status, 404);
    assert.equal((await fetch(formatted)).status, 404);
    assert.equal((await fetch(origin + route)).status, 404);
    await start("owner@example.test");
    await page.goto(origin + "/mailboxes/" + box + "/inbox/messages/" + id);
    await page.getByText("Attachments · 4", { exact: true }).click();
    await page.getByText("Calendar invitation", { exact: true }).click();
    await page.getByLabel("Your response").selectOption("TENTATIVE");
    await page.getByRole("button", { name: "Review calendar reply" }).click();
    await page.waitForURL("**/drafts/*");
    const reply = new URL(page.url()).pathname.split("/").at(-1);
    const draft = await json("/api/mailboxes/" + box + "/drafts/" + reply);
    assert.equal(draft.content.to, "appointments@fiction.test");
    assert.equal(draft.content.from, "support@mail.test");
    assert.equal(draft.content.files[0].calendar, "reply");
    await page.getByRole("button", { name: "Send to capture" }).click();
    const out = "/api/mailboxes/" + box + "/outbox/" + reply;
    for (let i = 0; i < 160 && (await json(out)).state !== "sent"; i++) await sleep(200);
    assert.equal((await json(out)).state, "sent");
    const sent = await fetch(origin + "/api/mailboxes/" + box + "/archive/" + reply);
    const source = await sent.text(),
      parsed = await PostalMime.parse(source);
    assert.match(source, /Content-Type: text\/calendar; method=REPLY/i);
    const calendar = new TextDecoder().decode(parsed.attachments[0].content);
    assert.match(calendar, /METHOD:REPLY/);
    assert.match(calendar, /UID:local/);
    assert.match(calendar, /SEQUENCE:4/);
    assert.match(calendar, /ATTENDEE;PARTSTAT=TENTATIVE:mailto:support@mail.test/i);
    await start(email);
    console.log(
      "PASS · isolated attachment download, exact bytes, cookie-free redemption, tampering and immediate grant revocation",
    );
  } finally {
    await page.close();
  }
}
