import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api, type Workspace } from "./api";
const fields = [
  ["r2_soft", "Storage warning (bytes)"],
  ["r2_hard", "Storage limit (bytes)"],
  ["d1_soft", "Estimated index warning (bytes)"],
  ["d1_hard", "Estimated index limit (bytes)"],
  ["sender_rate", "Deliveries per sender per minute"],
  ["recipient_rate", "Deliveries per address per minute"],
] as const;
const data = z.nullable(z.record(z.string(), z.union([z.number(), z.string(), z.null()])));
export function MailboxQuota({ space }: { space: Workspace }) {
  const [open, setOpen] = useState(false),
    [box, setBox] = useState(space.managed[0]?.id || "");
  const path = "mailboxes/" + box + "/quota";
  const q = useQuery({
    queryKey: ["quota", box],
    enabled: open && !!box,
    queryFn: async () => data.parse(await api(path)),
  });
  const save = useMutation({
    mutationFn: (v: object) => api(path, v),
    onSuccess: () => q.refetch(),
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Mailbox storage and inbound limits</summary>
      <label>
        Mailbox to limit
        <select
          value={box}
          onChange={(e) => {
            setBox(e.target.value);
            save.reset();
          }}
        >
          {space.managed.map((b) => (
            <option key={b.id} value={b.id}>
              {b.address}
            </option>
          ))}
        </select>
      </label>
      {(q.error || save.error) && <p role="alert">{(q.error || save.error)?.message}</p>}
      {q.isSuccess && (
        <form
          key={box + ":" + q.dataUpdatedAt}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            save.mutate(
              Object.fromEntries(fields.map(([k]) => [k, f.get(k) ? Number(f.get(k)) : null])),
            );
          }}
        >
          <p>
            Soft limits alert the owner. Hard limits stop new receipts. Leave a field empty for
            unlimited use.
          </p>
          {q.data && (
            <p>
              Mailbox storage · {Number(q.data.r2_bytes).toLocaleString()} bytes. Estimated index ·{" "}
              {Number(q.data.estimated_d1_bytes).toLocaleString()} bytes.
            </p>
          )}
          {fields.map(([k, title]) => (
            <label key={k}>
              {title}
              <input type="number" step="1" min="1" name={k} defaultValue={q.data?.[k] ?? ""} />
            </label>
          ))}
          <button disabled={save.isPending}>Save mailbox limits</button>
          {save.isSuccess && <output>Mailbox limits saved.</output>}
        </form>
      )}
    </details>
  );
}
