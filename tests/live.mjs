import assert from "node:assert/strict";
export async function checkLive({ browser, start, json, origin, box, privateBox, sql }) {
  const email = "live@example.test";
  await start("owner@example.test");
  await json("/api/users", { email });
  await json("/api/mailboxes/" + box + "/members", { email, role: "reader" });
  await start(email);
  const page = await browser.newPage();
  try {
    const appSocket = page.waitForEvent("websocket", {
      predicate: (socket) => new URL(socket.url()).pathname === "/api/live/" + box,
    });
    await page.goto(origin + "/mailboxes/" + box + "/inbox");
    await appSocket;
    await page.getByRole("list", { name: "Conversations" }).getByRole("link").first().waitFor();
    const open = async (boxId) =>
      page.evaluate(async (id) => {
        const s = new WebSocket(location.origin.replace(/^http/, "ws") + "/api/live/" + id);
        window.liveMessages = [];
        s.addEventListener("message", (e) => window.liveMessages.push(e.data));
        s.addEventListener("close", (e) => {
          window.liveClosed = e.code;
        });
        return new Promise((r) => {
          s.addEventListener("open", () => r(true));
          s.addEventListener("error", () => r(false));
        });
      }, boxId);
    assert.equal(await open(privateBox), false);
    assert.equal(await open(box), true);
    const deliver = (subject) =>
      fetch(origin + "/cdn-cgi/local/email?from=team%40external.test&to=support%40mail.test", {
        method: "POST",
        body: [
          "From: team@external.test",
          "To: support@mail.test",
          "Subject: " + subject,
          "Message-ID: <" + subject.replaceAll(" ", "-") + "@external.test>",
          "",
          "Live receipt fixture.",
        ].join("\r\n"),
      });
    assert.ok((await deliver("Live receipt")).ok);
    await page.waitForFunction(
      () => window.liveMessages.includes("changed"),
      {},
      { timeout: 10000 },
    );
    await page.getByRole("link", { name: /Live receipt/ }).waitFor({ timeout: 6000 });
    assert.deepEqual(await page.evaluate(() => window.liveMessages), ["changed"]);
    sql(
      "DELETE FROM mailbox_members WHERE user_id=(SELECT user_id FROM user_emails WHERE email='live@example.test')",
    );
    assert.ok((await deliver("Revoked receipt")).ok);
    await page.waitForFunction(() => window.liveClosed === 1008, {}, { timeout: 10000 });
    assert.deepEqual(await page.evaluate(() => window.liveMessages), ["changed"]);
    console.log(
      "PASS · live receipt updates, private mailbox isolation and immediate denial on the next update after grant revocation",
    );
  } finally {
    await page.close();
  }
}
