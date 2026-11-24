import { useEffect, useRef, useState } from "react";
import * as z from "zod/mini";
import { api, type Box } from "./api";
import { fileEntry } from "./compose-files";
export const schema = z.object({
  id: z.string(),
  revision: z.number(),
  content: z.object({
    to: z.string(),
    cc: z.string(),
    bcc: z.string(),
    subject: z.string(),
    body: z.string(),
    files: z.optional(z.array(fileEntry)),
    from: z.optional(z.string()),
    include_signature: z.optional(z.boolean()),
    rich: z.optional(z.boolean()),
  }),
});
export type Draft = z.infer<typeof schema>;
export const draftPath = (box: string) => "mailboxes/" + box + "/drafts";
export function useDraftAutosave(box: Box, draft: Draft) {
  const [content, setContent] = useState(draft.content),
    [status, setStatus] = useState("Saved");
  const state = useRef({
    revision: draft.revision,
    latest: draft.content,
    saved: draft.content,
    busy: false,
    blocked: false,
    timer: 0,
  });
  const pending = useRef<Promise<void> | null>(null);
  function save() {
    pending.current ??= write().finally(() => {
      pending.current = null;
    });
    return pending.current;
  }
  async function write() {
    const s = state.current;
    if (s.busy || s.blocked || s.saved === s.latest) return;
    s.busy = true;
    setStatus("Saving…");
    try {
      while (s.saved !== s.latest) {
        const value = s.latest;
        const updated = schema.parse(
          await api(draftPath(box.id) + "/" + draft.id, { revision: s.revision, content: value }),
        );
        s.revision = updated.revision;
        s.saved = value;
      }
      setStatus("Saved");
    } catch (e) {
      s.blocked = e instanceof Error && e.message.includes("another session");
      setStatus(e instanceof Error ? e.message : "Save failed");
    } finally {
      s.busy = false;
    }
  }
  const flush = useRef(save);
  useEffect(() => {
    const s = state.current;
    const flushPending = flush.current;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (s.latest !== s.saved) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      clearTimeout(s.timer);
      void flushPending();
    };
  }, [state, flush]);
  function edit<K extends keyof Draft["content"]>(field: K, value: Draft["content"][K]) {
    const s = state.current,
      snapshot = { ...s.latest, [field]: value };
    s.latest = snapshot;
    setContent(snapshot);
    if (!s.blocked) setStatus("Unsaved changes");
    clearTimeout(s.timer);
    s.timer = window.setTimeout(() => void save(), 400);
  }
  function discardUnsaved() {
    state.current.latest = state.current.saved;
  }
  return { content, status, setStatus, state, edit, save, discardUnsaved };
}
