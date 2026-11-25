import { SenderAvatar } from "./mail-display";
import type { detailSchema } from "./api";
export function messagePerson(m: {
  folder: string;
  sender: string;
  recipients?: string | null;
  cc?: string | null;
}) {
  return m.folder === "sent"
    ? "To " + ((m.recipients || m.cc)?.split("\n").join(", ") || "undisclosed recipients")
    : m.sender || "Unknown sender";
}
export function RecipientHeader({ m }: { m: ReturnType<typeof detailSchema.parse> }) {
  return (
    <div className="byline">
      <SenderAvatar sender={m.sender} />
      <div>
        <strong>{messagePerson(m)}</strong>
        <details className="recipient-details">
          <summary>Recipients</summary>
          <dl>
            <dt>From</dt>
            <dd>{m.sender}</dd>
            <dt>To</dt>
            <dd>{m.recipients?.split("\n").join(", ") || "Undisclosed"}</dd>
            {m.cc && (
              <>
                <dt>Cc</dt>
                <dd>{m.cc.split("\n").join(", ")}</dd>
              </>
            )}
          </dl>
        </details>
        <small>{new Date(m.received_at).toLocaleString()}</small>
      </div>
    </div>
  );
}
