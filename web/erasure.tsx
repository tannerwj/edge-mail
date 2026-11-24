import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as z from "zod/mini";
import { api, type Workspace } from "./api";
import { destination } from "./navigation";
export function EraseMessage({ box, id }: { box: string; id: string }) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const navigate = useNavigate(),
    client = useQueryClient();
  async function remove() {
    setBusy(true);
    try {
      await api("mailboxes/" + box + "/erase/" + id, { confirm: id });
      await navigate(destination({ box, folder: "trash" }));
      await client.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deletion failed");
      setBusy(false);
    }
  }
  return (
    <div>
      {confirm ? (
        <>
          <p>
            Permanently remove this message and its attachments? Other people sharing the mailbox
            will lose access. Locked backup copies expire separately.
          </p>
          <button disabled={busy} onClick={() => void remove()}>
            Confirm permanent deletion
          </button>{" "}
          <button disabled={busy} onClick={() => setConfirm(false)}>
            Keep message
          </button>
        </>
      ) : (
        <button onClick={() => setConfirm(true)}>Delete permanently</button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
const rows = z.array(
  z.object({ id: z.string(), at: z.number(), hidden: z.number(), pending: z.number() }),
);
export function ErasureReceipts({ space }: { space: Workspace }) {
  const boxes = space.mailboxes.filter((b) => b.can_forward);
  const [box, setBox] = useState(boxes[0]?.id || ""),
    [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["erasures", box],
    enabled: !!box && open,
    queryFn: async () => rows.parse(await api("mailboxes/" + box + "/erasures")),
  });
  if (!boxes.length) return null;
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Deletion receipts</summary>
      <label>
        Deletion history mailbox
        <select value={box} onChange={(e) => setBox(e.target.value)}>
          {boxes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.address}
            </option>
          ))}
        </select>
      </label>
      {q.error && <p role="alert">{q.error.message}</p>}
      {q.data?.length === 0 && <p>No permanent deletions recorded.</p>}
      {q.data?.map((r) => (
        <p key={r.id}>
          {new Date(r.at).toLocaleString()} ·{" "}
          {r.pending ? "Storage cleanup pending" : "Storage cleanup complete"}
          <small> · {r.id}</small>
        </p>
      ))}
    </details>
  );
}
