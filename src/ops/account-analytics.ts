import * as z from "zod/mini";
import type { Bindings } from "../env";
const result = z.object({
  data: z.object({
    viewer: z.object({
      accounts: z.array(
        z.object({ emailSendingAdaptiveGroups: z.array(z.object({ count: z.number() })) }),
      ),
    }),
  }),
});
const totals =
  "query MonthlySending($account: string!, $start: Date!, $end: Date!) {viewer {accounts(filter: {accountTag: $account}) {emailSendingAdaptiveGroups(filter: {date_geq: $start, date_leq: $end, isLastEvent: 1}, limit: 1) {count}}}}";
export async function refreshAnalytics(env: Bindings) {
  if (!env.ACCOUNT_ANALYTICS_TOKEN || !env.MAIL_ACCOUNT_ID) return;
  const now = Date.now(),
    end = new Date(now).toISOString().slice(0, 10),
    month = end.slice(0, 7);
  const claim = await env.DB.prepare(
    "INSERT INTO account_usage(id,month,checked) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET month=excluded.month,checked=excluded.checked,operations=NULL WHERE excluded.checked-account_usage.checked>=3600000 OR excluded.month!=account_usage.month",
  )
    .bind(month, now)
    .run();
  if (!claim.meta.changes) return;
  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: {
        authorization: "Bearer " + env.ACCOUNT_ANALYTICS_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: totals,
        variables: { account: env.MAIL_ACCOUNT_ID, start: month + "-01", end },
      }),
    });
    if (!response.ok) return;
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== "object" ||
      ("errors" in body &&
        body.errors != null &&
        (!Array.isArray(body.errors) || body.errors.length))
    )
      return;
    const list = result.parse(body).data.viewer.accounts;
    if (list.length !== 1) return;
    const count = list[0].emailSendingAdaptiveGroups[0]?.count ?? 0;
    if (!Number.isSafeInteger(count) || count < 0) return;
    await env.DB.prepare("UPDATE account_usage SET operations=? WHERE id=1 AND checked=?")
      .bind(count, now)
      .run();
  } catch {
    /* The read-only account metric is optional. The local reservation remains authoritative. */
  }
}
export async function accountUsage(env: Bindings) {
  if (!env.ACCOUNT_ANALYTICS_TOKEN || !env.MAIL_ACCOUNT_ID) return null;
  return env.DB.prepare(
    "SELECT operations,checked FROM account_usage WHERE id=1 AND month=strftime('%Y-%m','now') AND operations IS NOT NULL AND checked>unixepoch()*1000-7200000",
  ).first<{ operations: number; checked: number }>();
}
