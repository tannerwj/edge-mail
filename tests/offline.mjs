import assert from "node:assert/strict";
export async function checkOffline({ browser, origin, start, box, sql, json }) {
  const ctx = await browser.newContext();
  try {
    await start("owner@example.test");
    const email = "offline@example.test";
    await json("/api/users", { email });
    await json("/api/mailboxes/" + box + "/members", { email, role: "reader" });
    await start(email);
    const p = await ctx.newPage();
    const settings = origin + "/settings/personal";
    await p.goto(settings);
    await p.getByRole("button", { name: "Save mail on this device" }).click();
    await p
      .getByText(/conversations saved/)
      .waitFor({ timeout: 15000 })
      .catch(async (error) => {
        throw Error(
          error.message +
            " Offline status: " +
            (await p.locator("output").allTextContents()).join(" "),
        );
      });
    const session = await json("/api/offline/session");
    const page = await json("/api/offline/threads?scope=" + session.scope);
    assert.ok(page.threads.length && page.threads.every((t) => t.mailbox === "Support"));
    await ctx.setOffline(true);
    await p.getByText(/saved conversations · Read only/).waitFor();
    await p.close();
    const cold = await ctx.newPage();
    await cold.goto(origin + "/inboxes");
    await cold
      .getByText(/saved conversations · Read only/)
      .waitFor({ timeout: 6000 })
      .catch(async (e) => {
        throw Error(
          e.message +
            " Cold state " +
            JSON.stringify(
              await cold.evaluate(() => ({
                text: document.body.innerText.slice(0, 150),
                online: navigator.onLine,
                hidden: document.hidden,
                path: location.pathname,
                controlled: !!navigator.serviceWorker.controller,
              })),
            ),
        );
      });
    await cold.locator("summary").first().click();
    await cold.locator("details[open] pre").waitFor();
    sql(
      "DELETE FROM mailbox_members WHERE user_id=(SELECT user_id FROM user_emails WHERE email='offline@example.test')",
    );
    await ctx.setOffline(false);
    await cold.waitForURL("**/app");
    await cold.waitForFunction(async () => !(await (await import("/offline/device.js")).saved()));
    await start("owner@example.test");
    await cold.goto(settings);
    await cold.getByRole("button", { name: "Save mail on this device" }).click();
    await cold.getByText(/conversations saved/).waitFor();
    await start("reader@example.test");
    await cold.reload();
    await cold.waitForFunction(async () => !(await (await import("/offline/device.js")).saved()));
    await cold.getByRole("button", { name: "Save mail on this device" }).click();
    await cold.getByText(/conversations saved/).waitFor();
    await ctx.setOffline(true);
    await cold.getByText(/saved conversations · Read only/).waitFor();
    await cold.clock.install();
    await cold.clock.setSystemTime(new Date(Date.now() + 3700000));
    await cold.reload();
    await cold.getByText("Reconnect and sign in to read mail on this device.").waitFor();
    assert.equal(await cold.locator("details").count(), 0);
    console.log(
      "PASS · opt-in offline text, cold start, expiry, grant removal on reconnect and account switching",
    );
  } finally {
    await ctx.close();
  }
}
