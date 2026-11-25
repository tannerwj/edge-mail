import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api, type Workspace } from "./api";
const schema = z.array(z.object({ from: z.string(), signature: z.string() }));
function useIdentities(box: string, enabled: boolean) {
  return useQuery({
    queryKey: ["identities", box],
    enabled: !!box && enabled,
    queryFn: async () => schema.parse(await api("mailboxes/" + box + "/identities")),
  });
}
type Choice = { from?: string; include_signature?: boolean };
export function FromIdentity({
  box,
  choice,
  select,
  signature,
}: {
  box: string;
  choice: Choice;
  select: (s: string) => void;
  signature: (v: boolean) => void;
}) {
  const q = useIdentities(box, true);
  if (!q.data?.length) return null;
  const current = q.data.find((i) => i.from === choice.from) ?? q.data[0];
  return (
    <>
      <label>
        From address
        <select value={choice.from ?? current.from} onChange={(e) => select(e.target.value)}>
          {q.data.map((i) => (
            <option key={i.from}>{i.from}</option>
          ))}
        </select>
      </label>
      {current.signature && (
        <div>
          <label>
            <input
              type="checkbox"
              checked={choice.include_signature !== false}
              onChange={(e) => signature(e.target.checked)}
            />{" "}
            Include signature
          </label>
          {choice.include_signature !== false && <pre>{current.signature}</pre>}
        </div>
      )}
    </>
  );
}
function SignatureForm({ box, from, value }: { box: string; from: string; value: string }) {
  const [text, setText] = useState(value),
    [status, setStatus] = useState("");
  const client = useQueryClient();
  async function save() {
    try {
      await api("mailboxes/" + box + "/signatures", { from, signature: text });
      await client.invalidateQueries({ queryKey: ["identities", box] });
      setStatus("Signature saved.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not save signature");
    }
  }
  return (
    <>
      <label>
        Signature
        <textarea
          value={text}
          maxLength={4096}
          onChange={(e) => {
            setText(e.target.value);
            setStatus("");
          }}
        />
      </label>
      <button onClick={() => void save()}>Save signature</button>
      <p role="status">{status}</p>
    </>
  );
}
export function Signatures({ space }: { space: Workspace }) {
  const boxes = space.mailboxes.filter((b) => b.can_forward),
    [box, setBox] = useState(boxes[0]?.id || ""),
    [from, setFrom] = useState(""),
    [open, setOpen] = useState(false);
  const q = useIdentities(box, open),
    identity = q.data?.find((i) => i.from === from) ?? q.data?.[0];
  if (!boxes.length) return null;
  return (
    <details id="sending-signatures" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Sending identities and signatures</summary>
      <label>
        Sending mailbox
        <select
          value={box}
          onChange={(e) => {
            setBox(e.target.value);
            setFrom("");
          }}
        >
          {boxes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.address}
            </option>
          ))}
        </select>
      </label>
      {identity ? (
        <>
          <label>
            Sending identity
            <select
              aria-label="Sending identity"
              value={identity.from}
              onChange={(e) => setFrom(e.target.value)}
            >
              {q.data?.map((i) => (
                <option key={i.from}>{i.from}</option>
              ))}
            </select>
          </label>
          <SignatureForm
            key={box + identity.from}
            box={box}
            from={identity.from}
            value={identity.signature}
          />
        </>
      ) : (
        <p>
          {q.error?.message ||
            "Configure a sending identity during installation to add a signature."}
        </p>
      )}
    </details>
  );
}
