import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
const page = z.object({
  available: z.boolean(),
  domains: z.array(z.string()),
  next: z.nullable(z.string()),
  items: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      read_only: z.boolean(),
      reason: z.string(),
      expires_at: z.nullable(z.string()),
      scope: z.object({ value: z.string() }),
    }),
  ),
});
export function Suppressions({ owner }: { owner: boolean }) {
  const [open, setOpen] = useState(false),
    [domain, setDomain] = useState(""),
    [cursor, setCursor] = useState(""),
    [review, setReview] = useState("");
  const q = useQuery({
    queryKey: ["suppressions", domain, cursor],
    enabled: open,
    queryFn: async () => {
      const p = new URLSearchParams();
      if (domain) p.set("domain", domain);
      if (cursor) p.set("cursor", cursor);
      return page.parse(await api("suppressions?" + p));
    },
  });
  const remove = useMutation({
    mutationFn: (v: object) => api("suppressions", v),
    onSuccess: () => {
      setReview("");
      return q.refetch();
    },
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Suppressed recipients</summary>
      {q.data?.available ? (
        <>
          <label>
            Sending domain
            <select
              value={domain || q.data.domains[0]}
              onChange={(e) => {
                setDomain(e.target.value);
                setCursor("");
                setReview("");
              }}
            >
              {q.data.domains.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          {q.data.items.map((r) => (
            <article key={r.id}>
              <strong>{r.email}</strong>
              <p>
                {r.reason.replaceAll("_", " ")} ·{" "}
                {r.expires_at
                  ? "Expires " + new Date(r.expires_at).toLocaleDateString()
                  : "No expiry"}
              </p>
              {owner &&
                !r.read_only &&
                (review === r.id ? (
                  <>
                    <p>
                      Removing this suppression allows future delivery attempts to {r.email} from{" "}
                      {r.scope.value}.
                    </p>
                    <button
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate({ id: r.id, email: r.email, domain: r.scope.value })
                      }
                    >
                      Confirm removal
                    </button>
                    <button onClick={() => setReview("")}>Keep suppression</button>
                  </>
                ) : (
                  <button onClick={() => setReview(r.id)}>Remove suppression</button>
                ))}
            </article>
          ))}
          {!q.data.items.length && <p>No suppressed recipients on this page.</p>}
          {q.data.next && <button onClick={() => setCursor(q.data?.next ?? "")}>Next page</button>}
          {cursor && <button onClick={() => setCursor("")}>First page</button>}
        </>
      ) : (
        q.data && (
          <p>Connect the Email Sending credential and a sending identity to view suppressions.</p>
        )
      )}
      {(q.error || remove.error) && <p role="alert">{(q.error || remove.error)?.message}</p>}
    </details>
  );
}
