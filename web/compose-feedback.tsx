import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
import { useDraftLink } from "./navigation";

export type Feedback = { kind: "send" | "scheduled" | "discard"; until: number; revision?: number };
export type Notice = Feedback & { box: string; id: string };
const storedNotices = z.array(
  z.object({
    box: z.string(),
    id: z.string(),
    kind: z.enum(["send", "scheduled", "discard"]),
    until: z.number(),
    revision: z.optional(z.number()),
  }),
);
export function useComposeFeedback(user: string) {
  const key = "edge-mail-undo:" + user;
  const [notices, setNotices] = useState<Notice[]>(() => {
    try {
      return storedNotices
        .parse(JSON.parse(sessionStorage.getItem(key) || "[]"))
        .filter((n) => n.until > Date.now());
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      if (notices.length) sessionStorage.setItem(key, JSON.stringify(notices));
      else sessionStorage.removeItem(key);
    } catch {
      /* In-memory undo still works. */
    }
  }, [key, notices]);
  const clear = useCallback(
    (id: string) => setNotices((list) => list.filter((item) => item.id !== id)),
    [],
  );
  const show = (item: Notice) =>
    setNotices((list) => [...list.filter((v) => v.id !== item.id), item]);
  return { notices, clear, show };
}
export function UndoNotice({ notice, clear }: { notice: Notice; clear: (id: string) => void }) {
  const navigate = useNavigate(),
    link = useDraftLink(),
    client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { id, box, until, kind } = notice;
  useEffect(() => {
    if (busy || error) return undefined;
    const timer = setTimeout(() => clear(id), Math.max(0, until - Date.now()));
    return () => clearTimeout(timer);
  }, [id, until, busy, error, clear]);
  async function undo() {
    setBusy(true);
    setError("");
    try {
      const discard = kind === "discard";
      const result = z
        .object({ id: z.string() })
        .parse(
          await api(
            "mailboxes/" + box + "/" + (discard ? "drafts" : "outbox") + "/" + id,
            discard ? { action: "restore", revision: notice.revision } : { action: "undo" },
          ),
        );
      await client.invalidateQueries({ queryKey: ["drafts", box] });
      await client.invalidateQueries({ queryKey: ["outbox", box] });
      await navigate(link(box, result.id));
      clear(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not undo");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="compose-feedback">
      <span role="status">
        {error ||
          { send: "Message queued", scheduled: "Send scheduled", discard: "Draft discarded" }[kind]}
      </span>
      <button
        disabled={busy}
        type="button"
        aria-label={kind === "discard" ? "Undo discard" : "Undo send"}
        onClick={() => void undo()}
      >
        Undo
      </button>
      <button aria-label="Dismiss notification" type="button" onClick={() => clear(id)}>
        ×
      </button>
    </div>
  );
}
