import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
const path = "users/erasure";
const people = z.array(z.object({ id: z.string(), emails: z.string() }));
const preview = z.object({ target: z.string(), boxes: z.array(z.string()), drafts: z.number() });
const receipts = z.array(z.object({ target: z.string(), at: z.number(), finished: z.number() }));
export function PersonErasure() {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(""),
    [confirmed, setConfirmed] = useState("");
  const client = useQueryClient();
  const directory = useQuery({
    queryKey: ["erase-people-directory"],
    queryFn: async () => people.parse(await api("users")),
    enabled: open,
  });
  const history = useQuery({
    queryKey: ["person-erasure-history"],
    queryFn: async () => receipts.parse(await api(path)),
    enabled: open,
    refetchInterval: open ? 15000 : false,
  });
  const review = useMutation({
    mutationFn: async () => preview.parse(await api(path, { action: "preview", target: selected })),
  });
  const erase = useMutation({
    mutationFn: () =>
      api(path, {
        action: "erase",
        target: selected,
        confirm: selected,
        boxes: review.data?.boxes,
      }),
    onSuccess: async () => {
      review.reset();
      setSelected("");
      setConfirmed("");
      await client.invalidateQueries();
    },
  });
  const record = directory.data?.find((r) => r.id === selected);
  const email = record ? z.array(z.string()).parse(JSON.parse(record.emails))[0] : "";
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Erase a person’s data</summary>
      <p>
        Permanently remove sign-ins, private drafts and mailboxes where this person is the only
        member. Shared mailbox messages stay available to other members.
      </p>
      <label>
        Person to erase
        <select
          value={selected}
          disabled={erase.isPending}
          onChange={(e) => {
            setSelected(e.target.value);
            setConfirmed("");
            review.reset();
            erase.reset();
          }}
        >
          <option value="">Choose a person</option>
          {directory.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {JSON.parse(p.emails).join(", ")}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!selected || review.isPending || erase.isPending}
        onClick={() => review.mutate()}
      >
        Review data erasure
      </button>
      {review.data?.target === selected && (
        <>
          <p>
            {review.data.boxes.length} private mailboxes and {review.data.drafts} private drafts
            will be erased. Locked originals can take 35 days to expire.
          </p>
          <label>
            Type {email} to confirm
            <input
              autoComplete="off"
              value={confirmed}
              onChange={(e) => setConfirmed(e.target.value)}
            />
          </label>
          <button
            disabled={!email || confirmed !== email || erase.isPending}
            onClick={() => erase.mutate()}
          >
            Permanently erase this person
          </button>
        </>
      )}
      {(erase.error || review.error || directory.error || history.error) && (
        <p role="alert">
          {(erase.error || review.error || directory.error || history.error)?.message}
        </p>
      )}
      {history.data?.map((r) => (
        <p key={r.target}>
          Receipt {r.target} · {new Date(r.at).toLocaleString()} ·{" "}
          {r.finished ? "Cleanup complete" : "Cleanup pending"}
        </p>
      ))}
    </details>
  );
}
