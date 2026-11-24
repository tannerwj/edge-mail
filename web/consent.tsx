import { PolicyFields, readPolicy } from "./grant-policy";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api, spaceSchema } from "./api";
import { Mark } from "./mail-display";
const response = z.object({
  handle: z.string(),
  details: z.object({
    clientName: z.string(),
    clientDomain: z.optional(z.string()),
    redirectHost: z.string(),
    redirectIsLoopback: z.boolean(),
    scope: z.array(z.string()),
  }),
});
const labels: Record<string, string> = {
  "mail.read": "Read mail and attachments",
  "mail.write": "Read, organize and send mail",
  admin: "Manage the instance and credentials",
};
function Permissions({ busy, scopes, role }: { busy: boolean; scopes: string[]; role: string }) {
  return (
    <fieldset disabled={busy}>
      <legend>Permissions</legend>
      {Object.entries(labels)
        .filter(([k]) => k !== "admin" || role !== "member")
        .map(([k, label]) => (
          <label key={k}>
            <input
              type="checkbox"
              name="scope"
              value={k}
              defaultChecked={scopes.length ? scopes.includes(k) : k === "mail.read"}
            />{" "}
            {label}
          </label>
        ))}
    </fieldset>
  );
}
export function Consent() {
  const [all, setAll] = useState(true),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  const q = useQuery({
    queryKey: ["authorization", location.search],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const [request, workspace] = await Promise.all([
        api("oauth/consent", { action: "begin", query: location.search.slice(1) }),
        api("workspace"),
      ]);
      return { ...response.parse(request), space: spaceSchema.parse(workspace) };
    },
  });
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!q.data) return;
    const d = new FormData(e.currentTarget),
      approve =
        e.nativeEvent instanceof SubmitEvent &&
        e.nativeEvent.submitter?.getAttribute("value") === "approve";
    setBusy(true);
    setFailure("");
    try {
      const result = z.object({ redirect: z.string() }).parse(
        await api("oauth/consent", {
          action: approve ? "approve" : "deny",
          handle: q.data.handle,
          scopes: d.getAll("scope"),
          boxes: all ? null : d.getAll("box"),
          days: Number(d.get("days")),
          policy: readPolicy(d),
        }),
      );
      location.assign(result.redirect);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not finish authorization");
      setBusy(false);
    }
  }
  const details = q.data?.details;
  return (
    <main className="standalone">
      <div className="wordmark">
        <Mark /> Edge Mail
      </div>
      <h1>Connect a mail client</h1>
      {q.isPending && <p role="status">Loading authorization request…</p>}
      {q.error && <p role="alert">{q.error.message}</p>}
      {details && q.data && (
        <form onSubmit={(e) => void submit(e)}>
          <h2>{details.clientName}</h2>
          {details.clientDomain && <p>Verified client domain · {details.clientDomain}</p>}
          <p>
            Approval returns you to <strong>{details.redirectHost}</strong>.
          </p>
          {details.redirectIsLoopback && (
            <p>This callback opens a program running on your device.</p>
          )}
          <PolicyFields />
          <Permissions busy={busy} scopes={details.scope} role={q.data.space.user.role} />
          <label>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All
            mailboxes I can access
          </label>
          {!all && (
            <fieldset>
              <legend>Choose mailboxes</legend>
              {q.data.space.mailboxes.map((b) => (
                <label key={b.id}>
                  <input type="checkbox" name="box" value={b.id} /> {b.address}
                </label>
              ))}
            </fieldset>
          )}
          <label>
            Grant duration in days
            <input type="number" name="days" min="1" max="90" required defaultValue="30" />
          </label>
          <button disabled={busy} value="approve">
            Approve connection
          </button>{" "}
          <button disabled={busy} formNoValidate value="deny">
            Deny
          </button>
        </form>
      )}
      {failure && (
        <div role="alert">
          <p>{failure}</p>
          <button
            onClick={() => {
              setFailure("");
              void q.refetch();
            }}
          >
            Restart authorization
          </button>
        </div>
      )}
    </main>
  );
}
