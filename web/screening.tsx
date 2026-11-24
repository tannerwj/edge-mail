import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api, type Workspace } from "./api";
const result = z.object({
  settings: z.object({
    screen_unknown: z.number(),
    quarantine_auth: z.number(),
    learn: z.number(),
  }),
  list: z.array(z.object({ scope_id: z.string(), pattern: z.string(), disposition: z.string() })),
  pending: z.array(z.object({ sender: z.string(), count: z.number() })),
});
function Controls({
  value,
  save,
  busy,
}: {
  value: z.infer<typeof result>["settings"];
  save: (d: Record<string, unknown>) => void;
  busy: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        save({
          action: "settings",
          screen_unknown: d.has("unknown"),
          quarantine_auth: d.has("auth"),
          learn: d.has("learn"),
        });
      }}
    >
      <fieldset disabled={busy}>
        <legend>Incoming mail</legend>
        <label>
          <input type="checkbox" name="unknown" defaultChecked={!!value.screen_unknown} /> Hold
          unknown senders for review
        </label>
        <label>
          <input type="checkbox" name="auth" defaultChecked={!!value.quarantine_auth} /> Move mail
          that fails DMARC to Spam
        </label>
        <label>
          <input type="checkbox" name="learn" defaultChecked={!!value.learn} /> Filter using spam
          feedback from this instance
        </label>
        <button>Save screening preferences</button>
      </fieldset>
    </form>
  );
}
function HeldSenders({
  pending,
  save,
  busy,
}: {
  pending: z.infer<typeof result>["pending"];
  save: (d: Record<string, unknown>) => void;
  busy: boolean;
}) {
  return (
    <>
      <h3>Awaiting review</h3>
      {!pending.length && <p>No senders are waiting.</p>}
      <ul>
        {pending.map((r) => (
          <li key={r.sender}>
            {r.sender} · {r.count} held{" "}
            <button
              disabled={busy}
              onClick={() => save({ pattern: r.sender, disposition: "allow" })}
            >
              Allow {r.sender}
            </button>{" "}
            <button
              disabled={busy}
              onClick={() => save({ pattern: r.sender, disposition: "block" })}
            >
              Block {r.sender}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
export function Screening({ space }: { space: Workspace }) {
  const [open, setOpen] = useState(false),
    [box, setBox] = useState(space.managed[0].id);
  const path = "mailboxes/" + box + "/screening",
    client = useQueryClient();
  const q = useQuery({
    queryKey: ["screen", box],
    enabled: open,
    queryFn: async () => result.parse(await api(path)),
  });
  const update = useMutation({
    mutationFn: (data: Record<string, unknown>) => api(path, data),
    onSuccess: async () => {
      await q.refetch();
      await client.invalidateQueries({ queryKey: ["inbox", box] });
    },
  });
  const save = (d: Record<string, unknown>) => update.mutate(d),
    busy = update.isPending;
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Sender screening</summary>
      <label>
        Review mailbox
        <select value={box} onChange={(e) => setBox(e.target.value)}>
          {space.managed.map((b) => (
            <option key={b.id} value={b.id}>
              {b.address}
            </option>
          ))}
        </select>
      </label>
      {q.error && <p role="alert">{q.error.message}</p>}
      {q.data && (
        <>
          <Controls
            key={box + JSON.stringify(q.data.settings)}
            value={q.data.settings}
            save={save}
            busy={busy}
          />
          <HeldSenders pending={q.data.pending} save={save} busy={busy} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              save({
                pattern: d.get("pattern"),
                disposition: d.get("disposition"),
                instance: d.has("instance"),
              });
            }}
          >
            <fieldset disabled={busy}>
              <legend>Sender list</legend>
              <label>
                Address or domain
                <input name="pattern" required maxLength={254} />
              </label>
              <label>
                Action
                <select name="disposition">
                  <option value="allow">Allow</option>
                  <option value="block">Block</option>
                </select>
              </label>
              {space.user.role !== "member" && (
                <label>
                  <input type="checkbox" name="instance" /> Apply to every mailbox
                </label>
              )}
              <button>Save sender</button>
            </fieldset>
          </form>
          <ul>
            {q.data.list.map((r) => (
              <li key={r.scope_id + r.pattern}>
                {r.pattern} · {r.disposition} ·{" "}
                {r.scope_id === "*" ? "All mailboxes" : "This mailbox"}{" "}
                {(r.scope_id !== "*" || space.user.role !== "member") && (
                  <button
                    disabled={busy}
                    aria-label={"Remove " + r.pattern}
                    onClick={() =>
                      save({
                        pattern: r.pattern,
                        disposition: "remove",
                        instance: r.scope_id === "*",
                      })
                    }
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <output aria-live="polite">
        {update.error?.message || (update.isSuccess ? "Saved." : "")}
      </output>
    </details>
  );
}
