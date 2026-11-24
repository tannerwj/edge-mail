import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api, type Workspace } from "./api";
const result = z.object({
  enabled: z.boolean(),
  reports: z.array(
    z.object({
      message_id: z.string(),
      issuer: z.string(),
      reporter: z.string(),
      domain: z.string(),
      begin: z.number(),
      end: z.number(),
      total: z.number(),
      aligned: z.number(),
      rejected: z.number(),
      quarantined: z.number(),
    }),
  ),
});
export function AggregateReports({ space }: { space: Workspace }) {
  const boxes = space.mailboxes.filter((b) => b.can_forward),
    [box, setBox] = useState(boxes[0]?.id || ""),
    [open, setOpen] = useState(false);
  const route = "mailboxes/" + box + "/reports";
  const q = useQuery({
    queryKey: ["aggregate-reports", box],
    enabled: open && !!box,
    queryFn: async () => result.parse(await api(route)),
  });
  const m = useMutation({
    mutationFn: (enabled: boolean) => api(route, { enabled }),
    onSuccess: () => q.refetch(),
  });
  if (!boxes.length) return null;
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>DMARC aggregate reports</summary>
      <label>
        Reporting mailbox
        <select aria-label="Reporting mailbox" value={box} onChange={(e) => setBox(e.target.value)}>
          {boxes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.address}
            </option>
          ))}
        </select>
      </label>
      {q.data && (
        <>
          <button type="button" disabled={m.isPending} onClick={() => m.mutate(!q.data.enabled)}>
            {q.data.enabled ? "Stop collecting reports" : "Start collecting reports"}
          </button>
          <p>
            Use this mailbox as the rua address in the domain’s DMARC policy. Counts come from
            incoming authenticated reports.
          </p>
          {!q.data.reports.length && <p>No matching reports received yet.</p>}
          {q.data.reports.map((r) => (
            <article key={r.message_id + r.reporter + r.issuer + r.begin}>
              <strong>
                {r.issuer} · {r.reporter}
              </strong>
              <p>
                {r.domain} · {new Date(r.begin * 1000).toLocaleDateString()} –{" "}
                {new Date(r.end * 1000).toLocaleDateString()}
              </p>
              <p>
                {r.aligned} of {r.total} aligned · {r.rejected} rejected · {r.quarantined}{" "}
                quarantined
              </p>
              <a href={"/mailboxes/" + box + "/inbox/messages/" + r.message_id}>
                Open original report
              </a>
            </article>
          ))}
        </>
      )}
      {(q.error || m.error) && <p role="alert">{(q.error || m.error)?.message}</p>}
    </details>
  );
}
