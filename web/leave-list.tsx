import React, { useState } from "react";
import { api } from "./api";
export function LeaveList({ box, id, host }: { box: string; id: string; host: string }) {
  const [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function leave() {
    setBusy(true);
    try {
      await api("mailboxes/" + box + "/unsubscribe/" + id, { confirm: host });
      setMessage("The publisher accepted your unsubscribe request.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  if (message) return <p role="status">{message}</p>;
  if (!review)
    return (
      <button className="quiet" onClick={() => setReview(true)}>
        Unsubscribe
      </button>
    );
  return (
    <div>
      <p>Ask {host} to unsubscribe this shared mailbox?</p>
      <button disabled={busy} onClick={() => void leave()}>
        Confirm unsubscribe
      </button>
      <button className="quiet" disabled={busy} onClick={() => setReview(false)}>
        Cancel
      </button>
    </div>
  );
}
