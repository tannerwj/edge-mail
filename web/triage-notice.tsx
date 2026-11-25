import { useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
export async function refreshMail(client: QueryClient) {
  await Promise.all(
    ["workspace", "inbox", "unified-inbox", "message"].map((key) =>
      client.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
export async function fileMessages(ids: string[], field: string, value: string | boolean) {
  const result = z
    .object({ matched: z.number(), undo: z.optional(z.string()) })
    .parse(await api("inbox/triage", { ids, field, value }));
  if (result.undo) {
    const description =
      field === "is_read"
        ? value
          ? "Marked read"
          : "Marked unread"
        : value === "trash"
          ? "Moved to Trash"
          : "Archived";
    window.dispatchEvent(
      new CustomEvent("mail-triage", {
        detail: {
          text: description + (ids.length > 1 ? " · " + ids.length + " messages" : ""),
          undo: result.undo,
        },
      }),
    );
  }
}
const noticeSchema = z.object({
  text: z.string(),
  undo: z.string(),
  snooze: z.optional(z.object({ box: z.string(), thread: z.string() })),
});
export function listNotice(detail: z.infer<typeof noticeSchema>) {
  window.dispatchEvent(new CustomEvent("mail-triage", { detail }));
}
export function TriageNotice() {
  const [notice, setNotice] = useState<z.infer<typeof noticeSchema>>(),
    [busy, setBusy] = useState(false);
  const client = useQueryClient();
  useEffect(() => {
    const show = (e: Event) => {
      if (e instanceof CustomEvent) setNotice(noticeSchema.parse(e.detail));
    };
    window.addEventListener("mail-triage", show);
    return () => window.removeEventListener("mail-triage", show);
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(undefined), notice.undo ? 25000 : 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function undo() {
    if (!notice) return;
    setBusy(true);
    try {
      if (notice.snooze)
        await api("mailboxes/" + notice.snooze.box + "/reminders", {
          action: "thread_snooze",
          at: null,
          ids: [notice.snooze.thread],
          undo_revision: notice.undo,
        });
      else await api("inbox/triage", { undo: notice.undo });
      setNotice({ text: "Change undone", undo: "" });
      await refreshMail(client);
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "Could not undo", undo: "" });
    } finally {
      setBusy(false);
    }
  }
  return (
    notice && (
      <div className="triage-notice" role="status">
        {notice.text}{" "}
        {notice.undo && (
          <button disabled={busy} onClick={() => void undo()}>
            Undo
          </button>
        )}
      </div>
    )
  );
}
