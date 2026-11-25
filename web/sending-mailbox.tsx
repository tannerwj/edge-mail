import * as z from "zod/mini";
import { api, type Box } from "./api";
import { draftPath, type Draft, type useDraftAutosave } from "./draft-state";
import type { WindowActions } from "./compose-desk";
export function SendingMailbox({
  box,
  draft,
  controls,
  editor,
  uploading,
  setMoving,
}: {
  box: Box;
  draft: Draft;
  controls: WindowActions;
  editor: ReturnType<typeof useDraftAutosave>;
  uploading: boolean;
  setMoving: (v: boolean) => void;
}) {
  const { save, state } = editor;
  async function transfer(target: string) {
    setMoving(true);
    try {
      await save();
      if (state.current.latest !== state.current.saved) return;
      const moved = z.object({ id: z.string() }).parse(
        await api(draftPath(box.id) + "/" + draft.id, {
          action: "move",
          mailbox: target,
          revision: state.current.revision,
        }),
      );
      controls.transfer(target, moved.id);
    } catch (error) {
      editor.setStatus(error instanceof Error ? error.message : "Could not move draft");
    } finally {
      setMoving(false);
    }
  }
  return (
    <>
      {!draft.parent && controls.mailboxes.some((b) => b.id !== box.id) && (
        <label>
          Sending mailbox
          <select
            value={box.id}
            disabled={uploading}
            onChange={(e) => void transfer(e.target.value)}
          >
            {!controls.mailboxes.some((b) => b.id === box.id) && (
              <option value={box.id}>{box.address}</option>
            )}
            {controls.mailboxes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.display_name} · {b.address}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
