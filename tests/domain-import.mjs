import { feedbackJourney } from "./project-feedback.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkDomainImport({ page, origin, request, json, start, state, wrangler }) {
  await start("owner@example.test");
  await page.goto(origin + "/settings");
  const categories = page.getByRole("navigation", { name: "Settings categories" });
  await categories.waitFor();
  assert.equal(await page.locator(".settings form").count(), 0);
  await page.getByLabel("Find a setting").fill("no matching category");
  await page.getByText(/No settings match/).waitFor();
  await page.getByLabel("Find a setting").fill("Cloudflare");
  assert.equal(await categories.getByRole("link").count(), 1);
  await page.getByRole("link", { name: /Mailboxes & domains/ }).click();
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await breadcrumb.getByText("Mailboxes & domains", { exact: true }).waitFor();
  const sectionNav = page.getByRole("navigation", { name: "Settings sections" });
  await sectionNav.getByRole("link", { name: "Preferences" }).click();
  await page.getByLabel("Reading layout").waitFor();
  await sectionNav.getByRole("link", { name: "Mailboxes & domains" }).click();
  await page.getByText("Import Cloudflare domains", { exact: true }).click();
  await page.getByText(/in your installation checkout/).waitFor();
  const zones = [
    { id: "registered", name: "mail.test" },
    { id: "shipping", name: "shipping.test" },
    { id: "billing", name: "billing.test" },
    { id: "unselected", name: "spare.test" },
  ];
  const path = join(state, "catalog.json");
  await writeFile(path, JSON.stringify({ zones, updated: "2026-10-01T00:00:00Z" }));
  wrangler([
    "r2",
    "object",
    "put",
    "edge-mail-receipts/instance/zone-catalog.json",
    "--local",
    "--persist-to",
    state,
    "--file",
    path,
  ]);
  await page.reload();
  await page.getByText("Import Cloudflare domains", { exact: true }).click();
  assert.ok(await page.getByRole("checkbox", { name: /mail.test/ }).isDisabled());
  await page.getByRole("checkbox", { name: "shipping.test" }).check();
  await page.getByLabel("Find a domain").fill("bill");
  await page.getByRole("checkbox", { name: "billing.test" }).check();
  await page.getByRole("button", { name: "Import selected domains (2)" }).click();
  await page.getByText("Added 2. Already present 0.").waitFor();
  await page.getByRole("link", { name: "Set up billing.test" }).click();
  assert.match(new URL(page.url()).pathname, /^\/domains\/[^/]+\/setup$/);
  await page.getByRole("button", { name: "Create standard mailboxes" }).click();
  await page.getByText(/Created 3 standard mailboxes/).waitFor();
  await page.getByRole("button", { name: "Create standard mailboxes" }).click();
  await page.getByText(/Created 0 standard mailboxes/).waitFor();
  const mailboxes = (await json("/api/workspace")).mailboxes.filter((b) =>
    b.address.endsWith("@billing.test"),
  );
  assert.deepEqual(mailboxes.map((b) => b.address).sort(), [
    "abuse@billing.test",
    "dmarc@billing.test",
    "postmaster@billing.test",
  ]);
  const available = await json("/api/domains/available");
  assert.deepEqual(
    available.zones
      .filter((z) => z.imported)
      .map((z) => z.name)
      .sort(),
    ["billing.test", "mail.test", "shipping.test"],
  );
  const repeat = { version: available.version, zones: ["billing", "shipping"] };
  assert.deepEqual(await json("/api/domains/import", repeat), { created: 0, existing: 2 });
  assert.equal(
    (await request("/api/domains/import", { ...repeat, zones: ["unselected", "unknown"] })).status,
    400,
  );
  assert.equal(
    (await request("/api/domains/import", { version: "old", zones: ["unselected"] })).status,
    409,
  );
  await start("manager@example.test");
  assert.equal((await request("/api/domains/available")).status, 403);
  assert.equal(
    (await request("/api/domains/import", { ...repeat, zones: ["unselected"] })).status,
    403,
  );
  await page.goto(origin + "/settings");
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  await page.goto(origin + "/settings/mailboxes");
  assert.equal(await page.getByText("Import Cloudflare domains", { exact: true }).count(), 0);
  await start("admin@example.test");
  assert.equal(
    (await json("/api/domains/available")).zones.find((z) => z.id === "unselected").imported,
    false,
  );
  await page.goto(origin + "/settings");
  await page.getByRole("link", { name: /About Edge Mail/ }).click();
  const about = page.getByRole("region", { name: "About Edge Mail" });
  const updates = about.getByRole("checkbox", { name: "Check for new releases on this device" });
  assert.equal(await updates.isChecked(), false);
  const link = new URL(
    await about.getByRole("link", { name: "Give project feedback" }).getAttribute("href"),
  );
  assert.equal(link.hostname, "github.com");
  assert.ok(link.searchParams.get("version"));
  await page.route("**/api/release-status", (route) =>
    route.fulfill({ json: { status: "update", latest: "v9.1.0" } }),
  );
  await updates.check();
  await about.getByRole("link", { name: /Version v9.1.0 is available/ }).waitFor();
  await updates.uncheck();
  assert.equal(await about.getByRole("link", { name: /Version v9.1.0/ }).count(), 0);
  await page.unroute("**/api/release-status");
  await feedbackJourney(page);
  console.log(
    "PASS · instance owner imports two zones across a filtered list, retries safely, and delegated administrators cannot enumerate or import other domains",
  );
}
