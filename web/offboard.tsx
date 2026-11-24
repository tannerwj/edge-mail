import { useState } from "react";
import * as z from "zod/mini";
import { api } from "./api";

const counts = { transferred: z.number(), cancelled: z.number() };
const plan = z.object(counts);
const receipt = z.object({ ...counts, id: z.string() });

export function Offboarding() {
  const [email, setEmail] = useState("");
  const [preview, setPreview] = useState<z.infer<typeof plan>>();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFeedback("");
    try {
      const recipient = email.trim().toLowerCase();
      if (!preview)
        setPreview(plan.parse(await api("users/offboard", { email: recipient, dry_run: true })));
      else {
        const result = receipt.parse(
          await api("users/offboard", { email: recipient, confirm: recipient }),
        );
        setFeedback(
          `Access disabled. Mailbox transfers: ${result.transferred}. Cancelled sends: ${result.cancelled}. Receipt ${result.id}.`,
        );
        setEmail("");
        setPreview(undefined);
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Could not disable access");
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Disable user access</summary>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Account to disable
          <input
            type="email"
            required
            value={email}
            disabled={busy}
            onChange={(e) => {
              setEmail(e.target.value);
              setPreview(undefined);
              setFeedback("");
            }}
          />
        </label>
        {preview && (
          <p>
            This disables sign-in and removes mailbox and domain grants for {email}. You will take
            ownership of {preview.transferred} {preview.transferred === 1 ? "mailbox" : "mailboxes"}
            . {preview.cancelled} pending sends will be cancelled.
          </p>
        )}
        <button disabled={busy}>
          {preview ? "Confirm disable access" : "Review access changes"}
        </button>
        <output aria-live="polite">{feedback}</output>
      </form>
    </details>
  );
}
