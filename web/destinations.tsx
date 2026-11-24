import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
const entry = z.object({
  id: z.string(),
  address: z.string(),
  verified_at: z.nullable(z.string()),
  disabled: z.number(),
  provider_verification: z.optional(z.boolean()),
});
export type Destination = z.infer<typeof entry>;
export function useDestinations(box: string, enabled: boolean) {
  return useQuery({
    queryKey: ["destinations", box],
    enabled,
    queryFn: async () => z.array(entry).parse(await api("mailboxes/" + box + "/destinations")),
  });
}
export function DestinationSettings({
  box,
  entries,
  refresh,
}: {
  box: string;
  entries: Destination[];
  refresh: () => void;
}) {
  const [email, setEmail] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(data: { action?: string; address?: string; id?: string }) {
    setBusy(true);
    try {
      const result = await api("mailboxes/" + box + "/destinations", data);
      setEmail("");
      setStatus(
        data.action === "verify"
          ? z.object({ verified_at: z.nullable(z.string()) }).parse(result).verified_at
            ? "Recipient verified."
            : "Waiting for the recipient to confirm the Cloudflare email."
          : "Saved",
      );
      refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Destination update failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Forwarding destinations</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save({ address: email });
        }}
      >
        <label>
          Forwarding email
          <input type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button disabled={busy}>Add destination</button>
        <output>{status}</output>
      </form>
      <ul>
        {entries
          .filter((e) => !e.disabled)
          .map((e) => (
            <li key={e.id}>
              {e.address} · {e.verified_at ? "Verified" : "Pending verification"}
              {!e.verified_at && e.provider_verification && (
                <button disabled={busy} onClick={() => void save({ action: "verify", id: e.id })}>
                  Request or check verification for {e.address}
                </button>
              )}
              {!e.verified_at && !e.provider_verification && (
                <p>
                  From your installation checkout, start verification with{" "}
                  <code>pnpm destination:verify --apply WORKER {e.id}</code>. Replace WORKER with
                  your deployed Worker name. Run it again after the recipient confirms.
                </p>
              )}
              <button disabled={busy} onClick={() => void save({ action: "disable", id: e.id })}>
                Disable {e.address}
              </button>
            </li>
          ))}
      </ul>
      <button onClick={refresh}>Refresh verification</button>
    </details>
  );
}
