import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export function operatorService() {
  const mutable = {
    id: randomUUID(),
    email: "customer@fiction.test",
    created_at: "2026-10-01T00:00:00Z",
    expires_at: null,
    reason: "manual",
    scope: { type: "sending_domain", value: "dispatch.test" },
    read_only: false,
  };
  const locked = { ...mutable, id: randomUUID(), read_only: true },
    foreign = { ...mutable, id: randomUUID(), scope: { type: "account" } };
  const items = [mutable, locked, foreign],
    state = { mutations: 0, reads: 0, address: null, confirmed: false };
  return {
    mutable,
    locked,
    foreign,
    state,
    async receive(request) {
      const u = new URL(request.url);
      assert.equal(u.origin, "https://api.cloudflare.com");
      if (u.pathname.endsWith("/graphql")) {
        assert.equal(request.headers.get("Authorization"), "Bearer fixture-analytics");
        const p = await request.json();
        assert.ok(p.query.includes("isLastEvent: 1") && p.variables.start.endsWith("-01"));
        state.reads++;
        return Response.json({
          data: { viewer: { accounts: [{ emailSendingAdaptiveGroups: [{ count: 2410 }] }] } },
        });
      }
      if (u.pathname.endsWith("/email/routing/addresses")) {
        assert.equal(request.headers.get("Authorization"), "Bearer fixture-routing");
        if (request.method === "POST") {
          assert.equal(state.address, null);
          state.address = (await request.json()).email;
          return Response.json({ success: true, result: { email: state.address, verified: null } });
        }
        return Response.json({
          success: true,
          result: state.address
            ? [{ email: state.address, verified: state.confirmed ? "2026-11-24T01:00:00Z" : null }]
            : [],
          result_info: { total_pages: 1 },
        });
      }
      assert.equal(request.headers.get("Authorization"), "Bearer fixture-suppressions");
      if (u.pathname.endsWith("/suppressions")) {
        assert.equal(u.searchParams.get("scope_value"), "dispatch.test");
        return Response.json({ success: true, result: items, result_info: { next_cursor: null } });
      }
      const id = u.pathname.split("/").pop(),
        item = items.find((i) => i.id === id);
      if (!item) return new Response(null, { status: 404 });
      if (request.method === "DELETE") {
        assert.equal(item, mutable);
        items.splice(items.indexOf(item), 1);
        state.mutations++;
      }
      return Response.json({ success: true, result: item });
    },
  };
}
export async function exerciseOperatorService(worker, jwt, provider) {
  const run = (path, data) =>
    worker.dispatchFetch("http://127.0.0.1/api/" + path, {
      method: data ? "POST" : "GET",
      headers: {
        "Cf-Access-Jwt-Assertion": jwt,
        Origin: "http://127.0.0.1",
        "Content-Type": "application/json",
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  const list = async () => {
    const r = await run("suppressions");
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  const space = await (await run("workspace")).json(),
    route = "mailboxes/" + space.mailboxes[0].id + "/destinations";
  const destination = await (await run(route, { address: "notification@fiction.test" })).json();
  const verify = async () => {
    const r = await run(route, { action: "verify", id: destination.id });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  assert.equal((await verify()).verified_at, null);
  assert.equal((await verify()).verified_at, null);
  assert.equal(provider.state.address, "notification@fiction.test");
  provider.state.confirmed = true;
  assert.ok((await verify()).verified_at);
  assert.ok((await (await run(route)).json()).find((d) => d.id === destination.id).verified_at);
  const page = await list();
  assert.equal(page.items.length, 2);
  assert.ok(page.items.every((i) => i.scope.value === "dispatch.test"));
  for (const i of [provider.foreign, provider.locked])
    assert.equal(
      (await run("suppressions", { id: i.id, email: i.email, domain: "dispatch.test" })).status,
      403,
    );
  assert.equal(
    (
      await run("suppressions", {
        id: provider.mutable.id,
        email: "another@fiction.test",
        domain: "dispatch.test",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await run("suppressions", {
        id: provider.mutable.id,
        email: provider.mutable.email,
        domain: "dispatch.test",
      })
    ).status,
    200,
  );
  assert.equal(provider.state.mutations, 1);
  assert.equal((await list()).items.length, 1);
  const service = await worker.getWorker();
  assert.equal((await service.scheduled({ cron: "*/5 * * * *" })).outcome, "ok");
  const r = await run("limits");
  const limits = await r.json();
  assert.equal(limits.account_analytics.operations, 2410);
  assert.ok(limits.alerts.some((a) => a.code === "account_warning"));
  assert.equal(provider.state.reads, 1);
  console.log(
    "PASS · owner sees a fresh account metric and approved sending domain, confirms one mutable suppression, and cannot remove protected or account-wide entries",
  );
}
