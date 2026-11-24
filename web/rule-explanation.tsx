import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import * as z from "zod/mini";
import { api } from "./api";
const result = z.object({
  reason: z.nullable(z.string()),
  rules: z.array(
    z.object({
      rule_id: z.string(),
      name: z.string(),
      scope: z.string(),
      revision: z.number(),
      actions: z.string(),
    }),
  ),
  deliveries: z.array(
    z.object({
      id: z.string(),
      matched_address: z.string(),
      kind: z.string(),
      plus_tag: z.nullable(z.string()),
      auth: z.string(),
    }),
  ),
});
const actions = z.array(z.object({ kind: z.string() }));
export function RuleExplanation({ box, id }: { box: string; id: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["explain", box, id],
    enabled: open,
    queryFn: async () => result.parse(await api("mailboxes/" + box + "/explain/" + id)),
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Why is this here?</summary>
      {q.error && <p role="alert">{q.error.message}</p>}
      {q.isLoading && <p role="status">Reading delivery history…</p>}
      {q.data && (
        <>
          {q.data.reason && <p>{q.data.reason}</p>}
          {q.data.deliveries.map((d) => (
            <p key={d.id}>
              Matched {d.matched_address} · {d.kind}
              {d.plus_tag && " · +" + d.plus_tag}
              <small>
                {Object.entries(JSON.parse(d.auth))
                  .map(([k, v]) => k.toUpperCase() + " " + v)
                  .join(" · ") || "Authentication unknown"}
              </small>
            </p>
          ))}
          {q.data.rules.length ? (
            q.data.rules.map((r) => (
              <p key={r.rule_id}>
                {r.name} · {r.scope} rule · version {r.revision}
                <small>
                  {actions
                    .parse(JSON.parse(r.actions))
                    .map((a) => a.kind.replaceAll("_", " "))
                    .join(", ")}
                </small>
              </p>
            ))
          ) : (
            <p>No rules ran on this message.</p>
          )}
        </>
      )}
    </details>
  );
}
