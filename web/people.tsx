import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api, type Workspace } from "./api";
const directory = z.array(
  z.object({
    id: z.string(),
    role: z.string(),
    emails: z.string(),
    disabled_at: z.nullable(z.string()),
  }),
);
export function People({ space }: { space: Workspace }) {
  const [open, setOpen] = useState(false),
    [box, setBox] = useState(""),
    [send, setSend] = useState(false),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["people"],
    enabled: open,
    queryFn: async () => directory.parse(await api("users")),
  });
  const client = useQueryClient();
  const selected = space.mailboxes.find((b) => b.id === box);
  async function submit(form: HTMLFormElement, login: boolean) {
    setStatus("");
    setBusy(true);
    const data = Object.fromEntries(new FormData(form));
    try {
      await api(
        login ? "users/logins" : "users/invitations",
        login ? data : { ...data, mailbox: box, send },
      );
      // A directory read started before the write can still be in flight on a slow connection.
      await client.cancelQueries({ queryKey: ["people"], exact: true });
      await q.refetch({ throwOnError: true });
      setStatus(
        login
          ? "Sign-in address added."
          : send
            ? "Access saved. Invitation queued in Outbox."
            : "Access saved.",
      );
      form.reset();
      setSend(false);
      setBox("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not save access");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>People and invitations</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(e.currentTarget, false);
        }}
      >
        <label>
          Person’s sign-in email
          <input type="email" name="email" required />
        </label>
        <label>
          Instance role
          <select name="role">
            <option value="member">Member</option>
            {space.user.role === "owner" && (
              <>
                <option value="admin">Administrator</option>
                <option value="owner">Instance owner</option>
              </>
            )}
          </select>
        </label>
        <label>
          Share a mailbox
          <select
            aria-label="Share a mailbox"
            value={box}
            onChange={(e) => {
              setBox(e.target.value);
              setSend(false);
            }}
          >
            <option value="">Choose later</option>
            {space.managed.map((b) => (
              <option key={b.id} value={b.id}>
                {b.address}
              </option>
            ))}
          </select>
        </label>
        {box && (
          <label>
            Mailbox role
            <select name="permission">
              <option value="reader">Reader</option>
              <option value="editor">Editor</option>
              <option value="owner">Mailbox owner</option>
            </select>
          </label>
        )}
        {selected?.send_from && (
          <label>
            <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} />
            Send an invitation email from {selected.send_from}
          </label>
        )}
        <p>
          The person also needs permission to sign in through your Cloudflare Access application.
        </p>
        <button disabled={busy}>Save person and access</button>
      </form>
      {q.error && <p role="alert">{q.error.message}</p>}
      {!!q.data?.length && (
        <Directory
          rows={q.data}
          role={space.user.role}
          busy={busy}
          save={(form) => submit(form, true)}
        />
      )}
      <output>{status}</output>
    </details>
  );
}

function Directory({
  rows,
  role,
  busy,
  save,
}: {
  rows: z.infer<typeof directory>;
  role: string;
  busy: boolean;
  save: (form: HTMLFormElement) => Promise<void>;
}) {
  return (
    <>
      <h3>Directory</h3>
      <ul>
        {rows.map((p) => (
          <li key={p.id}>
            {JSON.parse(p.emails).join(", ")} · {p.role}
            {p.disabled_at ? " · Disabled" : ""}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(e.currentTarget);
        }}
      >
        <label>
          Account for another sign-in address
          <select name="id" aria-label="Account for another sign-in address">
            {rows
              .filter((p) => !p.disabled_at && (role === "owner" || p.role === "member"))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {JSON.parse(p.emails)[0]}
                </option>
              ))}
          </select>
        </label>
        <label>
          Additional sign-in email
          <input type="email" required name="email" />
        </label>
        <button disabled={busy}>Add sign-in address</button>
      </form>
    </>
  );
}
