import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api, type Workspace } from "./api";
const list = z.object({
  hooks: z.array(
    z.object({
      id: z.string(),
      host: z.string(),
      events: z.string(),
      enabled: z.number(),
      version: z.number(),
    }),
  ),
  deliveries: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      state: z.string(),
      tries: z.number(),
      created: z.number(),
      hook: z.string(),
    }),
  ),
});
const issued = z.object({ secret: z.optional(z.string()), version: z.optional(z.number()) });
const events = [
  "message.received",
  "message.sent",
  "message.delivery",
  "rule.matched",
  "approval.requested",
];
function TopicPicker() {
  return (
    <fieldset>
      <legend>Events to send</legend>
      {events.map((e) => (
        <label key={e}>
          <input type="checkbox" name="event" value={e} defaultChecked={e === "message.received"} />
          {e}
        </label>
      ))}
    </fieldset>
  );
}
export function Webhooks({ space }: { space: Workspace }) {
  const boxes = space.mailboxes.filter((b) => b.can_forward);
  const [box, setBox] = useState(boxes[0]?.id || ""),
    [open, setOpen] = useState(false);
  const [secret, setSecret] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const client = useQueryClient(),
    path = "mailboxes/" + box + "/webhooks";
  const query = useQuery({
    queryKey: ["webhooks", box],
    enabled: !!box && open,
    queryFn: async () => list.parse(await api(path)),
  });
  async function save(data: Record<string, unknown>) {
    setBusy(true);
    setStatus("");
    setSecret("");
    try {
      const result = issued.parse(await api(path, data));
      setSecret(result.secret || "");
      setStatus(
        result.secret
          ? "Save this signing key in your receiver. It is shown once."
          : "Webhook disabled.",
      );
      await client.invalidateQueries({ queryKey: ["webhooks", box] });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not update webhook");
    } finally {
      setBusy(false);
    }
  }
  if (!boxes.length) return null;
  return (
    <details
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (!e.currentTarget.open) setSecret("");
      }}
    >
      <summary>Webhooks</summary>
      <label>
        Webhook mailbox
        <select
          value={box}
          onChange={(e) => {
            setBox(e.target.value);
            setSecret("");
            setStatus("");
          }}
        >
          {boxes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.address}
            </option>
          ))}
        </select>
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void save({ action: "create", url: d.get("url"), events: d.getAll("event") });
        }}
      >
        <label>
          Receiver URL
          <input required type="url" name="url" placeholder="https://example.com/mail-events" />
        </label>
        <TopicPicker />

        <button disabled={busy}>Create webhook</button>
      </form>
      <p role="status">{status}</p>
      {secret && (
        <label>
          Webhook signing key
          <input readOnly autoComplete="off" value={secret} onFocus={(e) => e.target.select()} />
          <button onClick={() => setSecret("")}>Hide key</button>
        </label>
      )}
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.data?.hooks.map((h) => (
        <article key={h.id}>
          <strong>{h.host}</strong> · {h.enabled ? "Active" : "Disabled"} · Key {h.version}
          <p>{JSON.parse(h.events).join(", ")}</p>
          {!!h.enabled && (
            <>
              <button disabled={busy} onClick={() => void save({ action: "rotate", id: h.id })}>
                Rotate key
              </button>{" "}
              <button disabled={busy} onClick={() => void save({ action: "disable", id: h.id })}>
                Disable webhook
              </button>
            </>
          )}
          <ul>
            {query.data.deliveries
              .filter((d) => d.hook === h.id)
              .map((d) => (
                <li key={d.id}>
                  {d.kind} · {d.state} · {d.tries} attempts · {new Date(d.created).toLocaleString()}
                </li>
              ))}
          </ul>
        </article>
      ))}
    </details>
  );
}
