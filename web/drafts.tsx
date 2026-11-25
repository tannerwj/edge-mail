import { SendingMailbox } from "./sending-mailbox";
import { useDraftActions } from "./draft-actions";
import { DraftRecipients } from "./recipients";
import { SendControls } from "./send-controls";
import { schema, useDraftAutosave, type Draft, draftPath } from "./draft-state";
import { FilePenLine, ChevronRight, Trash2, Reply, ReplyAll, Forward } from "lucide-react";
import { ComposeWindow } from "./compose-window";
import type { WindowActions } from "./compose-desk";
import { FolderEmpty, MailFolder } from "./mail-folder";
import { ComposerLibrary } from "./composer-library";
import { Formatting } from "./formatting";
import { FromIdentity } from "./identities";
import { ComposeFiles } from "./compose-files";
import { useDraftLink } from "./navigation";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ulid } from "ulid";
import * as z from "zod/mini";
import { api, type Box } from "./api";
const lists = z.object({
  drafts: z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      recipient: z.optional(z.string()),
      updated_at: z.string(),
    }),
  ),
});
export function NewDraft({
  box,
  parent,
  mode,
  title,
}: {
  box: Box;
  title: string;
  parent?: string;
  mode?: string;
}) {
  const shortcut =
    mode === "reply-all" ? "a" : mode === "reply" ? "r" : mode === "forward" ? "f" : "c";
  const draftLink = useDraftLink();
  const navigate = useNavigate(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef("");
  async function create() {
    setBusy(true);
    setError("");
    key.current ||= ulid();
    try {
      const draft = schema.parse(await api(draftPath(box.id), { id: key.current, parent, mode }));
      await navigate(draftLink(box.id, draft.id, shortcut));
      key.current = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open draft");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button data-shortcut={shortcut} disabled={busy} onClick={() => void create()}>
        {mode === "reply" ? (
          <Reply size={16} />
        ) : mode === "reply-all" ? (
          <ReplyAll size={16} />
        ) : mode === "forward" ? (
          <Forward size={16} />
        ) : null}
        {title}
      </button>
      {error && <output role="alert">{error}</output>}
    </>
  );
}
export function Drafts({ box }: { box: Box }) {
  const draftLink = useDraftLink();
  const list = useQuery({
    queryKey: ["drafts", box.id],
    refetchOnMount: "always",
    queryFn: async () => lists.parse(await api(draftPath(box.id))),
  });
  return (
    <MailFolder title="Drafts" icon={FilePenLine} mailbox={box.display_name}>
      {!list.data ? (
        <p role="status">{list.error?.message || "Loading…"}</p>
      ) : list.data.drafts.length === 0 ? (
        <FolderEmpty title="No drafts yet" icon={FilePenLine}>
          Choose Compose to start a message. Unsent edits are saved here.
        </FolderEmpty>
      ) : (
        list.data.drafts.map((d) => (
          <Link className="queue-row" key={d.id} {...draftLink(box.id, d.id)}>
            <FilePenLine size={18} />
            <div>
              <strong>{d.subject || "Untitled draft"}</strong>
              <small>{d.recipient || "No recipients yet"}</small>
            </div>
            <time dateTime={d.updated_at}>
              {new Date(d.updated_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </time>
            <ChevronRight size={16} />
          </Link>
        ))
      )}
    </MailFolder>
  );
}
export function DraftDialog({
  box,
  id,
  controls,
}: {
  box: Box;
  id: string;
  controls: WindowActions;
}) {
  const router = useRouter(),
    client = useQueryClient();
  const current = useQuery({
    queryKey: ["draft", box.id, id],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => schema.parse(await api(draftPath(box.id) + "/" + id)),
  });
  const dismissed = useRef(false);
  function close() {
    if (dismissed.current) return;
    dismissed.current = true;
    const draftURL = router.state.location.pathname;
    const shortcut = router.state.location.state.composeShortcut;
    if (router.state.location.pathname.endsWith("/drafts/" + id)) {
      const unsubscribe = router.subscribe("onRendered", () => {
        unsubscribe();
        requestAnimationFrame(() => {
          const trigger =
            shortcut &&
            [...document.querySelectorAll<HTMLElement>("[data-shortcut]")].find(
              (el) => el.dataset.shortcut === shortcut,
            );
          const row = [...document.querySelectorAll<HTMLAnchorElement>(".queue-row[href]")].find(
            (el) => el.pathname === draftURL,
          );
          (trigger || row)?.focus({ preventScroll: true });
        });
      });
    }
    void client.invalidateQueries({ queryKey: ["drafts", box.id] });
    controls.close();
  }
  return current.data ? (
    <Editor key={id} box={box} draft={current.data} controls={controls} close={close} />
  ) : (
    <ComposeWindow controls={controls} close={close}>
      <p role="status">{current.error?.message || "Opening draft…"}</p>
    </ComposeWindow>
  );
}
function DraftEnvelope({
  box,
  content,
  edit,
}: {
  box: string;
  content: Draft["content"];
  edit: ReturnType<typeof useDraftAutosave>["edit"];
}) {
  return (
    <>
      {" "}
      <FromIdentity
        box={box}
        choice={content}
        select={(v) => edit("from", v)}
        signature={(v) => edit("include_signature", v)}
      />
      <DraftRecipients box={box} content={content} edit={edit} />
      <label>
        Subject
        <input
          value={content.subject}
          maxLength={998}
          onChange={(e) => edit("subject", e.target.value)}
        />
      </label>
    </>
  );
}
function Editor({
  box,
  draft,
  controls,
  close,
}: {
  box: Box;
  draft: Draft;
  controls: WindowActions;
  close: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [moving, setMoving] = useState(false);
  const filesRef = useRef<HTMLDivElement>(null);
  const editor = useDraftAutosave(box, draft);
  const { content, status, state, edit, save, discardUnsaved } = editor;
  const { delay, setDelay, submitting, canSend, send, discard, reminder, setReminder } =
    useDraftActions(box, draft, editor, controls, uploading);
  async function dismiss() {
    if (moving || uploading || submitting) return;
    await save();
    if (state.current.saved === state.current.latest) return close();
    if (window.confirm("Your latest edits could not be saved. Close and discard those edits?")) {
      discardUnsaved();
      close();
    }
  }
  return (
    <ComposeWindow
      controls={controls}
      close={() => void dismiss()}
      subject={content.subject}
      save={save}
      send={() => {
        if (!moving) void send();
      }}
    >
      <div className="composer">
        <div className="compose-fields" ref={filesRef} inert={submitting || moving}>
          <SendingMailbox {...{ box, draft, controls, editor, uploading, setMoving }} />
          <DraftEnvelope box={box.id} content={content} edit={edit} />
          <Formatting
            rich={!!content.rich}
            value={content.body}
            toggle={(v) => edit("rich", v)}
            change={(v) => edit("body", v)}
          />
          <ComposeFiles
            box={box.id}
            draft={draft.id}
            files={content.files || []}
            busy={uploading || submitting}
            uploading={setUploading}
            update={(files) => edit("files", files)}
          />
          <ComposerLibrary
            box={box.id}
            content={{ subject: content.subject, body: content.body, rich: content.rich }}
            apply={(t) => {
              edit("subject", t.subject);
              edit("rich", !!t.rich);
              edit("body", t.body);
            }}
          />

          {!box.send_from && (
            <p className="compose-note">
              Drafts are saved here. This mailbox has no sending identity configured.
            </p>
          )}
          {reminder && (
            <div className="attachment-reminder" role="alert">
              <strong>Did you mean to attach a file?</strong>
              <button
                type="button"
                onClick={() => {
                  setReminder(undefined);
                  filesRef.current?.querySelector<HTMLInputElement>("input[type=file]")?.click();
                }}
              >
                Add attachment
              </button>
              <button type="button" onClick={() => void send(reminder.scheduledFor, true)}>
                {reminder.scheduledFor ? "Schedule anyway" : "Send anyway"}
              </button>
            </div>
          )}
          <footer className="compose-footer">
            <button
              type="button"
              className="quiet"
              aria-label="Discard draft"
              title="Discard draft"
              disabled={uploading || submitting}
              onClick={() => void discard()}
            >
              <Trash2 size={16} />
            </button>
            <button type="button" className="quiet" onClick={() => void save()}>
              Save draft
            </button>
            <SendControls
              box={box}
              delay={delay}
              setDelay={setDelay}
              disabled={!canSend || status !== "Saved"}
              send={send}
            />
            <output role="status">{status}</output>
          </footer>
        </div>
      </div>
    </ComposeWindow>
  );
}
