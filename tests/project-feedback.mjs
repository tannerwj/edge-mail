import assert from "node:assert/strict";
const report = {
  kind: "idea",
  tool_name: "Inbox",
  summary: "Group fictional receipts by sender.",
  server_version: "0.2.0",
};
export function feedbackService() {
  const reports = new Map();
  return {
    reports,
    async receive(request) {
      for (const header of ["cookie", "cf-access-jwt-assertion", "referer", "origin"])
        assert.equal(request.headers.has(header), false);
      const receipt = request.headers.get("authorization");
      assert.match(receipt, /^Bearer [\w-]{43}$/);
      if (request.method === "PUT") {
        assert.deepEqual(await request.json(), report);
        reports.set(receipt, report);
        return Response.json({ received: true });
      }
      assert.equal(request.method, "GET");
      return reports.has(receipt)
        ? Response.json({ status: "planned", reply: "Thanks for the suggestion.", issue: "" })
        : new Response(null, { status: 404 });
    },
  };
}
export async function exerciseFeedback(worker, jwt, otherJwt, service) {
  const id = crypto.randomUUID();
  const call = (token, payload, origin = "http://127.0.0.1") =>
    worker.dispatchFetch("http://127.0.0.1/api/project-feedback", {
      method: "POST",
      headers: { origin, "content-type": "application/json", "cf-access-jwt-assertion": token },
      body: JSON.stringify(payload),
    });
  const send = { action: "send", id, report };
  assert.equal((await call(jwt, send, "https://example.test")).status, 403);
  assert.equal(
    (await call(jwt, { ...send, report: { ...report, email: "fixture@example.test" } })).status,
    400,
  );
  assert.equal(service.reports.size, 0);
  for (let i = 0; i < 2; i++)
    assert.deepEqual(await (await call(jwt, send)).json(), { received: true });
  assert.equal(service.reports.size, 1);
  const status = { action: "status", id };
  assert.equal((await call(otherJwt, status)).status, 404);
  assert.equal((await (await call(jwt, status)).json()).reply, "Thanks for the suggestion.");
  console.log(
    "PASS · feedback retries share a receipt, only the reviewed fields leave the Worker and a second member cannot read the reply",
  );
}
export async function feedbackJourney(page) {
  let requests = [];
  await page.route("**/api/project-feedback", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (requests.length === 1)
      return route.fulfill({ status: 503, json: { error: "Try again later." } });
    return route.fulfill({
      json:
        body.action === "send"
          ? { received: true }
          : { status: "planned", reply: "Thanks for the suggestion.", issue: "" },
    });
  });
  await page.getByRole("link", { name: "Feedback", exact: true }).click();
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("idea");
  await page.getByRole("combobox", { name: "Area (optional)", exact: true }).selectOption("Inbox");
  await page.getByLabel("Summary", { exact: true }).fill(report.summary);
  await page.getByRole("button", { name: "Review feedback" }).click();
  await page.getByRole("button", { name: "Edit feedback" }).click();
  await page.getByRole("button", { name: "Review feedback" }).click();
  assert.equal(requests.length, 0);
  await page.getByRole("button", { name: "Send privately" }).click();
  await page.getByText("Try again later.", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Retry send" }).click();
  await page.getByText(/Feedback sent\./).waitFor();
  assert.deepEqual(requests[0], requests[1]);
  await page.getByRole("button", { name: "Check for reply" }).click();
  await page.getByText("Thanks for the suggestion.").waitFor();
  await page.getByRole("button", { name: "Remove receipt" }).click();
  await page.getByText("No reports on this device yet.").waitFor();
  await page.unroute("**/api/project-feedback");
}
