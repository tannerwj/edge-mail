import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { Archive, Clock3, Ellipsis } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
import { listNotice, refreshMail } from "./triage-notice";

async function fileConversation(box: string, thread: string, archive: boolean) {
  const base = "mailboxes/" + box + "/";
  if (archive) {
    const { undo } = z
      .object({ undo: z.string() })
      .parse(await api(base + "archive-thread/" + thread, {}));
    listNotice({ text: "Conversation archived", undo });
  } else {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    const { revision } = z.object({ revision: z.string() }).parse(
      await api(base + "reminders", {
        action: "thread_snooze",
        at: next.getTime(),
        ids: [thread],
        list_snooze: true,
      }),
    );
    listNotice({
      text: "Snoozed until " + next.toLocaleString(),
      undo: revision,
      snooze: { box, thread },
    });
  }
}
export function ListActions({
  box,
  thread,
  children,
}: {
  box: string;
  thread: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [working, setWorking] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null),
    ignoreTap = useRef(0),
    busy = useRef(false);
  const client = useQueryClient();
  async function act(archive: boolean) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setOpen(false);
    try {
      await fileConversation(box, thread, archive);
      await refreshMail(client);
    } catch (e) {
      listNotice({
        text: e instanceof Error ? e.message : "Could not update conversation",
        undo: "",
      });
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  function begin(e: TouchEvent) {
    start.current = null;
    if (
      localStorage.getItem("edge-mail-list-swipes") !== "on" ||
      !matchMedia("(max-width: 760px)").matches ||
      e.touches.length !== 1 ||
      !(e.target instanceof Element) ||
      e.target.closest("button,input")
    )
      return;
    const t = e.touches[0];
    if (t.clientX > 24 && t.clientX < innerWidth - 24)
      start.current = { x: t.clientX, y: t.clientY };
  }
  function finish(e: TouchEvent) {
    const first = start.current;
    start.current = null;
    if (!first || e.touches.length || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - first.x,
      dy = e.changedTouches[0].clientY - first.y;
    if (Math.abs(dx) < 85 || Math.abs(dy) > 35) return;
    ignoreTap.current = Date.now() + 500;
    void act(dx > 0);
  }
  return (
    <div
      className="list-action-row"
      onTouchStart={begin}
      onTouchCancel={() => {
        start.current = null;
      }}
      onTouchEnd={finish}
      onClickCapture={(e) => {
        if (Date.now() < ignoreTap.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {children}
      <button
        className="row-more"
        aria-label="Conversation actions"
        aria-expanded={open}
        disabled={working}
        onClick={() => setOpen((v) => !v)}
      >
        <Ellipsis size={18} />
      </button>
      {open && (
        <div
          className="row-actions"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <button aria-label="Close conversation actions" onClick={() => setOpen(false)}>
            ×
          </button>
          <button onClick={() => void act(true)}>
            <Archive size={15} /> Archive conversation
          </button>
          <button onClick={() => void act(false)}>
            <Clock3 size={15} /> Snooze until tomorrow at 9 AM
          </button>
        </div>
      )}
    </div>
  );
}
