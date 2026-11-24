import { useRef, useState } from "react";
import * as z from "zod/mini";
import { api, type Box } from "./api";
import type { Draft, useDraftAutosave } from "./draft-state";
import type { WindowActions } from "./compose-desk";
import { recipientsReady } from "./recipients";

type Operation = { kind: "discard" } | { kind: "send"; scheduledFor?: number };
function mentionsAttachment(body: string) {
  const own = body.split(/^[- ]{3,}Forwarded message[- ]*$/im)[0].replace(/^>.*$/gm, "");
  return /\b(attached|attachment[s]?|enclosed|attaching)\b/i.test(own);
}
export function useDraftActions(
  box: Box,
  draft: Draft,
  editor: ReturnType<typeof useDraftAutosave>,
  controls: WindowActions,
  uploading: boolean,
) {
  const [delay, setDelay] = useState(10),
    [submitting, setSubmitting] = useState(false);
  const [reminder, setReminder] = useState<{ scheduledFor?: number }>();
  const busy = useRef(false);
  const { content, state, setStatus, save } = editor;
  const canSend =
    !!box.send_from &&
    recipientsReady(content) &&
    !!content.subject.trim() &&
    !!content.body.trim() &&
    !uploading &&
    !submitting;
  async function run(op: Operation) {
    if (busy.current || uploading) return;
    busy.current = true;
    setSubmitting(true);
    setReminder(undefined);
    try {
      await save();
      const s = state.current;
      if (s.saved !== s.latest || s.blocked) return;
      const base = "mailboxes/" + box.id;
      if (op.kind === "discard") {
        const r = z
          .object({ discarded_until: z.number(), revision: z.number() })
          .parse(
            await api(base + "/drafts/" + draft.id, { action: "discard", revision: s.revision }),
          );
        controls.finish({ kind: "discard", until: r.discarded_until, revision: r.revision });
      } else {
        const r = z.object({ due_ms: z.number() }).parse(
          await api(base + "/outbox/" + draft.id, {
            action: "send",
            revision: s.revision,
            reopen: true,
            undoSeconds: delay,
            scheduledFor: op.scheduledFor,
          }),
        );
        controls.finish({
          kind: op.scheduledFor ? "scheduled" : "send",
          until: Math.min(Date.now() + delay * 1000, r.due_ms),
        });
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not finish draft");
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }
  async function send(scheduledFor?: number, confirmed = false) {
    if (!canSend) return;
    if (
      !confirmed &&
      !content.files?.length &&
      mentionsAttachment(content.subject + "\n" + content.body)
    ) {
      setReminder({ scheduledFor });
      return;
    }
    await run({ kind: "send", scheduledFor });
  }
  return {
    delay,
    setDelay,
    submitting,
    canSend,
    reminder,
    setReminder,
    send,
    discard: () => run({ kind: "discard" }),
  };
}
