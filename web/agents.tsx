import { PolicyFields, readPolicy } from "./grant-policy";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api, type Workspace } from "./api";

const grant = z.object({
  id: z.string(),
  name: z.string(),
  expires: z.number(),
  revoked: z.nullable(z.number()),
  last_used: z.nullable(z.number()),
  send_mode: z.nullable(z.string()),
  daily_cap: z.nullable(z.number()),
  review_egress: z.nullable(z.number()),
});
function PermissionFields({ space }: { space: Workspace }) {
  return (
    <fieldset>
      <legend>Permissions</legend>
      <label>
        <input type="checkbox" name="scope" value="mail.read" defaultChecked /> Read mail
      </label>
      <label>
        <input type="checkbox" name="scope" value="mail.write" /> Write mail
      </label>
      {space.user.role !== "member" && (
        <label>
          <input type="checkbox" name="scope" value="admin" /> Administer instance
        </label>
      )}
    </fieldset>
  );
}
export function AgentSettings({ space }: { space: Workspace }) {
  const [open, setOpen] = useState(false),
    [all, setAll] = useState(true),
    [token, setToken] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["my-grants"],
    enabled: open,
    queryFn: async () => z.array(grant).parse(await api("grants")),
  });
  async function issue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setToken("");
    try {
      const response = z.object({ token: z.string() }).parse(
        await api("grants", {
          name: data.get("name"),
          scopes: data.getAll("scope"),
          days: Number(data.get("days")),
          policy: readPolicy(data),
          boxes: all ? null : data.getAll("box"),
        }),
      );
      setToken(response.token);
      setStatus("Copy this token to your secret manager. It is shown once.");
      form.reset();
      setAll(true);
      await q.refetch();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not create token");
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    try {
      await api("grants/" + id + "/revoke", {});
      setToken("");
      setStatus("Access revoked, including child credentials.");
      await q.refetch();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not revoke token");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (!e.currentTarget.open) setToken("");
      }}
    >
      <summary>Connected agents</summary>
      <form onSubmit={(e) => void issue(e)}>
        <label>
          Token name
          <input name="name" required maxLength={100} />
        </label>
        <label>
          Expires in days
          <input type="number" min="1" max="90" defaultValue="30" required name="days" />
        </label>
        <PermissionFields space={space} />
        <PolicyFields />
        <label>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All
          current and future mailboxes I can access
        </label>
        {!all && (
          <fieldset>
            <legend>Permitted mailboxes</legend>
            {space.mailboxes.map((b) => (
              <label key={b.id}>
                <input type="checkbox" name="box" value={b.id} />
                {b.address}
              </label>
            ))}
          </fieldset>
        )}
        <button disabled={busy}>Create API token</button>
      </form>
      <output aria-live="polite">{status}</output>
      {token && (
        <label>
          New API token
          <input type="text" value={token} readOnly autoComplete="off" spellCheck={false} />
        </label>
      )}
      {q.error && <p role="alert">{q.error.message}</p>}
      <ul>
        {q.data?.map((g) => (
          <li key={g.id}>
            {g.name} ·{" "}
            {g.revoked ? "Revoked" : "Expires " + new Date(g.expires).toLocaleDateString()}{" "}
            {g.last_used && " · Last used " + new Date(g.last_used).toLocaleDateString()}
            {g.send_mode && g.send_mode !== "allow" && " · " + g.send_mode.replaceAll("_", " ")}
            {g.daily_cap && " · " + g.daily_cap + " recipients per day"}
            {g.review_egress === 1 && " · Egress requires approval"}
            {!g.revoked && (
              <button disabled={busy} onClick={() => void revoke(g.id)}>
                Revoke {g.name}
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
