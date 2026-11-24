import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
const status = z.object({
  account_analytics: z.nullable(z.object({ operations: z.number(), checked: z.number() })),
  policy: z.object({
    monthly_cap: z.nullable(z.number()),
    monthly_used: z.number(),
    paused: z.number(),
    agent_writes: z.number(),
  }),
  users: z.array(z.object({ email: z.string(), daily_cap: z.number() })),
  alerts: z.array(z.object({ id: z.string(), code: z.string(), created: z.number() })),
});
const runbooks: Record<string, string> = {
  mailbox_soft_quota:
    "A mailbox reached its configured storage warning. Review mailbox storage and inbound limits.",
  account_warning:
    "Account-wide sending reached 80% of the 3,000 included monthly sends. Check the provider billing view for current charges.",
  complaint: "A recipient complained. Review the provider event and the sender’s grant.",
  uncertain:
    "The provider may have accepted a message. Check the original submission before retrying.",
  sending_paused: "Sending is paused. Review provider status and the latest failed submissions.",
  ingest_failure:
    "A receipt needs processing. Review ingest failures and the stored original before replay.",
  outbox_late: "A scheduled message is overdue. Check the worker schedule and queue status.",
  monthly_warning: "Monthly reservations reached 80% of the configured cap.",
  database_80: "D1 storage reached 80%. Review storage growth and export older mail.",
  database_90: "D1 storage reached 90%. Verify the latest backup and prepare additional capacity.",
};
export function OperatingLimits({ owner }: { owner: boolean }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["limits"],
    enabled: open,
    queryFn: async () => status.parse(await api("limits")),
  });
  const change = useMutation({
    mutationFn: (a: object) => api("limits", a),
    onSuccess: () => q.refetch(),
  });
  const p = q.data?.policy;
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Delivery budgets and alerts</summary>
      {p && (
        <>
          <p>
            This month · {p.monthly_used} envelope recipients
            {p.monthly_cap ? " of " + p.monthly_cap : " · No monthly cap"}
          </p>
          <p>
            Account-wide analytics ·{" "}
            {q.data?.account_analytics
              ? q.data.account_analytics.operations +
                " sending operations · Updated " +
                new Date(q.data.account_analytics.checked).toLocaleString()
              : "Unavailable"}
          </p>
          {owner && (
            <fieldset disabled={change.isPending}>
              <legend>Instance controls</legend>
              <button onClick={() => change.mutate({ action: "sending", enabled: !!p.paused })}>
                {p.paused ? "Resume outbound mail" : "Pause outbound mail"}
              </button>
              <button
                onClick={() => change.mutate({ action: "agent_writes", enabled: !p.agent_writes })}
              >
                {p.agent_writes ? "Pause agent writes" : "Resume agent writes"}
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  change.mutate({ action: "monthly", cap: Number(f.get("cap")) || null });
                }}
              >
                <label>
                  Monthly recipient limit
                  <input
                    type="number"
                    min="1"
                    max="10000000"
                    name="cap"
                    placeholder="Unlimited"
                    defaultValue={p.monthly_cap ?? ""}
                  />
                </label>
                <button>Save monthly limit</button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  change.mutate({
                    action: "user",
                    email: f.get("email"),
                    cap: Number(f.get("cap")),
                  });
                }}
              >
                <label>
                  User sign-in address
                  <input name="email" type="email" required />
                </label>
                <label>
                  Daily recipient limit
                  <input name="cap" type="number" min="1" max="10000000" required />
                </label>
                <button>Save user limit</button>
              </form>
            </fieldset>
          )}
          {q.data?.users.map((u) => (
            <p key={u.email}>
              {u.email} · {u.daily_cap} recipients per day
            </p>
          ))}
          {q.data?.alerts.map((a) => (
            <p key={a.id}>
              {runbooks[a.code] ?? a.code} <time>{new Date(a.created).toLocaleString()}</time>{" "}
              {owner && (
                <button onClick={() => change.mutate({ action: "ack", id: a.id })}>
                  Acknowledge
                </button>
              )}
            </p>
          ))}
          {!q.data?.alerts.length && <p>No open delivery alerts.</p>}
        </>
      )}
      {(q.error || change.error) && <p role="alert">{(q.error || change.error)?.message}</p>}
    </details>
  );
}
