import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api, type Workspace } from "./api";
const result = z.object({
  label_plus: z.number(),
  addresses: z.array(
    z.object({
      canonical: z.string(),
      label: z.string(),
      expires: z.nullable(z.number()),
      disabled: z.number(),
      reason: z.nullable(z.string()),
      first_sender: z.nullable(z.string()),
    }),
  ),
});
export function ReceivingAddresses({ space }: { space: Workspace }) {
  const boxes = space.mailboxes.filter((b) => b.can_forward),
    [box, setBox] = useState(boxes[0]?.id || ""),
    [open, setOpen] = useState(false);
  const path = "mailboxes/" + box + "/disposable",
    client = useQueryClient();
  const q = useQuery({
    queryKey: ["disposables", box],
    enabled: !!box && open,
    queryFn: async () => result.parse(await api(path)),
  });
  const update = useMutation({
    mutationFn: (a: object) => api(path, a),
    onSuccess: () => client.invalidateQueries({ queryKey: ["disposables", box] }),
  });
  if (!boxes.length) return null;
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Disposable addresses</summary>
      <label>
        Receiving mailbox
        <select aria-label="Receiving mailbox" value={box} onChange={(e) => setBox(e.target.value)}>
          {boxes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.address}
            </option>
          ))}
        </select>
      </label>
      {q.data && (
        <label>
          <input
            type="checkbox"
            checked={!!q.data.label_plus}
            onChange={(e) => update.mutate({ action: "plus", on: e.target.checked })}
          />
          Label messages addressed with a plus tag
        </label>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          update.mutate({
            action: "create",
            label: f.get("label"),
            ttl_hours: Number(f.get("hours")) || null,
          });
        }}
      >
        <label>
          Address purpose
          <input name="label" maxLength={40} required placeholder="Order tracking" />
        </label>
        <label>
          Expires after (hours)
          <input type="number" min="1" max="8760" name="hours" placeholder="No expiry" />
        </label>
        <button disabled={update.isPending}>Create disposable address</button>
      </form>
      {q.data?.addresses.map((a) => (
        <article key={a.canonical}>
          <strong>{a.canonical}</strong>
          <p>
            {a.label} ·{" "}
            {a.disabled
              ? a.reason === "flood"
                ? "Suspended after a surge"
                : "Revoked"
              : a.expires
                ? "Expires " + new Date(a.expires).toLocaleString()
                : "No expiry"}
          </p>
          <p>{a.first_sender ? "First sender · " + a.first_sender : "No recorded sender yet"}</p>
          {!a.disabled && (
            <button
              disabled={update.isPending}
              onClick={() => update.mutate({ action: "disable", address: a.canonical })}
            >
              Revoke {a.canonical}
            </button>
          )}
        </article>
      ))}
      {(q.error || update.error) && <p role="alert">{(q.error || update.error)?.message}</p>}
    </details>
  );
}
const unknown = z.object({ mode: z.string(), mailbox_id: z.nullable(z.string()) });
export function UnknownRecipients({ space }: { space: Workspace }) {
  const [domain, setDomain] = useState(space.domains[0]?.id ?? ""),
    [open, setOpen] = useState(false);
  const path = "domains/" + domain + "/unknown-recipients";
  const q = useQuery({
    queryKey: ["unknown", domain],
    enabled: open && !!domain,
    queryFn: async () => unknown.parse(await api(path)),
  });
  const save = useMutation({
    mutationFn: (f: FormData) => api(path, Object.fromEntries(f)),
    onSuccess: () => q.refetch(),
  });
  if (!space.domains.length) return null;
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Unknown recipients</summary>
      <label>
        Receiving domain
        <select value={domain} onChange={(e) => setDomain(e.target.value)}>
          {space.domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <p>This policy applies when the domain’s catch-all routes mail to this instance.</p>
      {q.data && (
        <form
          key={domain}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(new FormData(e.currentTarget));
          }}
        >
          <label>
            Unrecognized address
            <select name="mode" defaultValue={q.data.mode}>
              <option value="reject">Reject at delivery</option>
              <option value="drop">Accept and discard</option>
              <option value="deliver">Deliver to a mailbox</option>
            </select>
          </label>
          <label>
            Catch-all mailbox
            <select name="mailbox" defaultValue={q.data.mailbox_id ?? ""}>
              <option value="">Choose mailbox</option>
              {space.mailboxes
                .filter((b) => b.domain_id === domain)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.address}
                  </option>
                ))}
            </select>
          </label>
          <button disabled={save.isPending}>Save recipient policy</button>
        </form>
      )}
      {(q.error || save.error) && <p role="alert">{(q.error || save.error)?.message}</p>}
      {save.isSuccess && <p role="status">Recipient policy saved.</p>}
    </details>
  );
}
