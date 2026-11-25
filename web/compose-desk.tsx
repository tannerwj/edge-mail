import { useQueryClient } from "@tanstack/react-query";
import { UndoNotice, useComposeFeedback, type Feedback } from "./compose-feedback";
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import type { Box } from "./api";
import { DraftDialog } from "./drafts";
import { destination } from "./navigation";
import { useComposeSession, type DraftRef, type DraftWindow, type Point } from "./compose-session";

export type WindowActions = {
  mailboxes: Box[];
  transfer: (box: string, next: string) => void;
  mode: DraftWindow["layout"] | "minimized";
  wide: boolean;
  position?: Point;
  move: (point: Point) => void;
  expand: (wide: boolean) => void;
  restore: () => void;
  place: (mode: WindowActions["mode"]) => void;
  close: () => void;
  finish: (info: Feedback) => void;
};
export function ComposeDesk({
  boxes,
  route,
  user,
}: {
  boxes: Box[];
  route?: DraftRef;
  user: string;
}) {
  const { desk, change, activate, remove } = useComposeSession(user, route);
  const router = useRouter(),
    client = useQueryClient();
  const feedback = useComposeFeedback(user);
  const navigate = useNavigate();
  const history = useLocation({ select: (l) => l.state });
  function leave(draft: DraftRef, sent = false) {
    if (draft.id !== route?.id) return;
    if (history.composeBehind && !(sent && history.composeBehind.folder === "drafts"))
      router.history.back();
    else
      void navigate({
        ...destination({ box: draft.box, folder: sent ? "inbox" : "drafts" }),
        replace: true,
      });
  }
  return (
    <div className="compose-desk">
      <div className="compose-notices">
        {feedback.notices.map((n) => (
          <UndoNotice key={n.id + n.kind} notice={n} clear={feedback.clear} />
        ))}
      </div>
      {desk.windows.map((draft) => {
        const box = boxes.find((b) => b.id === draft.box && (b.can_edit || route?.id === draft.id));
        if (!box) return null;
        const { id } = draft;
        return (
          <DraftDialog
            key={id}
            box={box}
            id={id}
            controls={{
              mailboxes: boxes.filter((b) => b.can_edit && b.send_from),
              transfer: (target, next) => {
                change(id, { box: target, id: next });
                if (route?.id === id)
                  void navigate({
                    ...destination({ box: target, draft: next }),
                    replace: true,
                    state: history,
                  });
                void client.invalidateQueries({ queryKey: ["drafts"] });
              },
              mode: desk.active === id ? draft.layout : "minimized",
              wide: draft.wide,
              position: draft.position,
              move: (position) => change(id, { position }),
              expand: (wide) => change(id, { wide }),
              restore: () => activate(id),
              place: (mode) => {
                if (mode === "minimized") activate(null);
                else change(id, { layout: mode, wide: false });
                leave(draft);
              },
              finish: (info) => {
                feedback.show({ ...info, id, box: box.id });
                remove(id);
                leave(draft, info.kind !== "discard");
                void client.invalidateQueries({ queryKey: ["drafts", box.id] });
                void client.invalidateQueries({ queryKey: ["outbox", box.id] });
              },
              close: () => {
                remove(id);
                leave(draft);
              },
            }}
          />
        );
      })}
    </div>
  );
}
