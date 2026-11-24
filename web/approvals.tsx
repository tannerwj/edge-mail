import { Link } from "@tanstack/react-router";
import { ApprovalDetail } from "./approval-detail";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
const review = z.object({
  id: z.string(),
  kind: z.string(),
  reason: z.string(),
  name: z.string(),
  subject: z.nullable(z.string()),
});
function Review({ row }: { row: z.infer<typeof review> }) {
  const [open, setOpen] = useState(false),
    [key, setKey] = useState("");
  const client = useQueryClient(),
    path = "approvals/" + row.id;
  const detail = useQuery({
    queryKey: ["approval", row.id],
    enabled: open,
    queryFn: () => api(path),
  });
  const decide = useMutation({
    mutationFn: (approve: boolean) => api(path, { approve }),
    onSuccess: async (v) => {
      const result = z.object({ secret: z.optional(z.string()) }).parse(v);
      if (result.secret) {
        setKey(result.secret);
        return;
      }
      await client.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {row.subject || row.reason} · {row.name}
      </summary>
      {detail.isLoading && <p>Loading request…</p>}
      {detail.error && <p role="alert">{detail.error.message}</p>}
      {detail.data !== undefined && (
        <>
          <ApprovalDetail data={detail.data} />
          <button disabled={decide.isPending || !!key} onClick={() => decide.mutate(true)}>
            Approve request
          </button>{" "}
          <button disabled={decide.isPending || !!key} onClick={() => decide.mutate(false)}>
            Decline request
          </button>
        </>
      )}
      {decide.error && <p role="alert">{decide.error.message}</p>}
      {key && (
        <label>
          Signing key for the receiver
          <input readOnly autoComplete="off" value={key} />
          <button
            onClick={() => {
              setKey("");
              void client.invalidateQueries({ queryKey: ["approvals"] });
            }}
          >
            I saved the key
          </button>
        </label>
      )}
    </details>
  );
}
function useApprovalRequests() {
  return useQuery({
    queryKey: ["approvals"],
    queryFn: async () => z.array(review).parse(await api("approvals")),
    refetchInterval: 60000,
  });
}
export function ApprovalsLink() {
  const q = useApprovalRequests();
  return q.data?.length ? <Link to="/approvals">Approvals · {q.data.length}</Link> : null;
}
export function Approvals() {
  const q = useApprovalRequests();
  return (
    <details open={q.data?.length ? true : undefined}>
      <summary>Agent approval requests{q.data?.length ? " · " + q.data.length : ""}</summary>
      {q.error && <p role="alert">{q.error.message}</p>}
      {q.data?.length === 0 && <p>No pending requests.</p>}
      {q.data?.map((r) => (
        <Review key={r.id} row={r} />
      ))}
    </details>
  );
}
