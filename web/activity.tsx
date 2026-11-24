import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api, type Workspace } from "./api";
const row = z.object({
  id: z.string(),
  op: z.string(),
  at: z.number(),
  affected: z.number(),
  name: z.string(),
  reversible: z.number(),
});
export function Activity({ space }: { space: Workspace }) {
  const [open, setOpen] = useState(false),
    [box, setBox] = useState(space.mailboxes[0]?.id || "");
  const path = "mailboxes/" + box + "/activity",
    client = useQueryClient(),
    q = useQuery({
      queryKey: ["activity", box],
      enabled: !!box && open,
      queryFn: async () => z.array(row).parse(await api(path)),
    });
  const undo = useMutation({
    mutationFn: (id: string) => api(path + "/" + id, {}),
    onSuccess: async () => {
      await q.refetch();
      await client.invalidateQueries({ queryKey: ["inbox", box] });
    },
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Agent activity</summary>
      <label>
        Activity mailbox
        <select value={box} onChange={(e) => setBox(e.target.value)}>
          {space.mailboxes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.address}
            </option>
          ))}
        </select>
      </label>
      {q.data && !q.data.length && <p>No agent actions recorded for this mailbox.</p>}
      <ul>
        {q.data?.map((r) => (
          <li key={r.id}>
            <strong>{r.name}</strong> · {r.op.replaceAll("_", " ")} · {r.affected} affected{" "}
            <small>{new Date(r.at).toLocaleString()}</small>
            {!!r.reversible && (
              <button disabled={undo.isPending} onClick={() => undo.mutate(r.id)}>
                Undo {r.op.replaceAll("_", " ")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {q.error && <p role="alert">{q.error.message}</p>}
      <output aria-live="polite">
        {undo.error?.message || (undo.isSuccess ? "Action undone." : "")}
      </output>
    </details>
  );
}
