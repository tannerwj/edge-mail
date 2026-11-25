import { Archive, Star, Mail, MailOpen, Folder } from "lucide-react";
import { fileMessages, refreshMail } from "./triage-notice";
import { EraseMessage } from "./erasure";
import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api, type Box } from "./api";
import { destination, type MailView } from "./navigation";
type Detail = { id: string; is_read: number; starred: number; folder: string; labels: string[] };
function TriageButtons({
  message,
  change,
}: {
  message: Detail;
  change: (field: string, value: boolean | string) => void;
}) {
  return (
    <>
      {" "}
      <button
        type="button"
        title={message.starred ? "Unstar" : "Star"}
        aria-label={message.starred ? "Unstar" : "Star"}
        aria-pressed={!!message.starred}
        onClick={() => change("starred", !message.starred)}
      >
        <Star size={17} fill={message.starred ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        aria-label={message.is_read ? "Mark unread" : "Mark read"}
        title={message.is_read ? "Mark unread" : "Mark read"}
        onClick={() => change("is_read", !message.is_read)}
      >
        {message.is_read ? <Mail size={17} /> : <MailOpen size={17} />}
      </button>
      {message.folder !== "sent" && message.folder !== "archive" && (
        <button
          title="Archive"
          aria-label="Archive"
          data-shortcut="e"
          onClick={() => change("folder", "archive")}
        >
          <Archive size={17} />
        </button>
      )}
    </>
  );
}
export function Actions({ box, message, view }: { box: Box; message: Detail; view: MailView }) {
  const client = useQueryClient(),
    navigate = useNavigate();
  const archive = useMutation({
    mutationFn: () => fileMessages([message.id], "folder", "archive"),
    onSuccess: async () => {
      await refreshMail(client);
      await navigate(destination({ ...view, box: box.id, message: undefined }));
      requestAnimationFrame(() => {
        (
          document.querySelector<HTMLElement>(".conversation-scroll .item") ||
          document.querySelector<HTMLElement>('[data-shortcut="/"]')
        )?.focus();
      });
    },
  });
  const save = useMutation({
    mutationFn: (data: { field: string; value: boolean | string }) =>
      data.field === "feedback"
        ? api("mailboxes/" + box.id + "/screening/" + message.id, { spam: data.value })
        : api("mailboxes/" + box.id + "/messages/" + message.id, data),
    onSuccess: async () => {
      await refreshMail(client);
    },
  });
  const [label, setLabel] = useState("");
  const change = (field: string, value: string | boolean) => save.mutate({ field, value });
  return (
    <div className="actions">
      {!!box.can_edit && (
        <fieldset disabled={save.isPending || archive.isPending}>
          <legend>Organize message</legend>
          <TriageButtons
            message={message}
            change={(field, value) =>
              field === "folder" ? archive.mutate() : change(field, value)
            }
          />
          <details className="organize-more">
            <summary>
              <Folder size={16} /> Move or label
            </summary>
            <div>
              {message.folder !== "sent" && (
                <button type="button" onClick={() => change("feedback", message.folder !== "spam")}>
                  {message.folder === "spam" ? "Not spam" : "Report spam"}
                </button>
              )}
              {message.folder !== "sent" && message.folder !== "trash" && (
                <button data-shortcut="#" onClick={() => change("folder", "trash")}>
                  Move to Trash
                </button>
              )}
              <label>
                Move to
                <select value={message.folder} onChange={(e) => change("folder", e.target.value)}>
                  {[
                    ...(message.folder === "sent" ? ["sent"] : []),
                    "inbox",
                    "archive",
                    "spam",
                    "trash",
                  ].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (label.trim())
                    save.mutate(
                      { field: "label", value: label },
                      { onSuccess: () => setLabel("") },
                    );
                }}
              >
                <input
                  aria-label="Label name"
                  placeholder="Label"
                  value={label}
                  maxLength={80}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <button disabled={!label.trim()}>Add label</button>
              </form>
            </div>
          </details>
        </fieldset>
      )}
      {!!box.can_forward && ["spam", "trash"].includes(message.folder) && (
        <EraseMessage key={message.id} box={box.id} id={message.id} />
      )}
      {message.labels.map((l) =>
        box.can_edit ? (
          <button
            className="tag"
            key={l}
            disabled={save.isPending}
            onClick={() => change("unlabel", l)}
            aria-label={"Remove label " + l}
          >
            {l} ×
          </button>
        ) : (
          <span className="tag" key={l}>
            {l}
          </span>
        ),
      )}
      {archive.error && <p role="alert">{archive.error.message}</p>}
      {save.error && <p role="alert">{save.error.message}</p>}
    </div>
  );
}

export function Appearance() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || "desk");
  const [color, setColor] = useState(document.documentElement.dataset.color || "system");
  return (
    <>
      <label className="appearance" id="list-swipes">
        <input
          type="checkbox"
          defaultChecked={localStorage.getItem("edge-mail-list-swipes") === "on"}
          onChange={(e) =>
            localStorage.setItem("edge-mail-list-swipes", e.target.checked ? "on" : "off")
          }
        />
        Swipe inbox rows on this device{" "}
        <small>Swipe right to archive or left to snooze until tomorrow at 9 AM.</small>
      </label>
      <label className="appearance" id="keyboard-shortcuts">
        <input
          type="checkbox"
          defaultChecked={localStorage.getItem("edge-mail-shortcuts") !== "off"}
          onChange={(e) =>
            localStorage.setItem("edge-mail-shortcuts", e.target.checked ? "on" : "off")
          }
        />{" "}
        Single-key mailbox shortcuts
      </label>
      <label className="appearance" id="read-on-open">
        <input
          type="checkbox"
          defaultChecked={localStorage.getItem("edge-mail-mark-on-open") === "on"}
          onChange={(e) =>
            localStorage.setItem("edge-mail-mark-on-open", e.target.checked ? "on" : "off")
          }
        />
        Mark read when opened on this device{" "}
        <small>Updates the shared unread count in mailboxes you can edit.</small>
      </label>
      <label className="appearance" id="color-scheme">
        Color scheme
        <select
          value={color}
          onChange={(e) => {
            const next = e.target.value;
            setColor(next);
            document.documentElement.dataset.color = next;
            localStorage.setItem("edge-mail-color", next);
          }}
        >
          <option value="system">Match device</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label id="reading-layout" className="appearance">
        Reading layout
        <select
          value={theme}
          onChange={(e) => {
            setTheme(e.target.value);
            document.documentElement.dataset.theme = e.target.value;
            localStorage.setItem("edge-mail-layout", e.target.value);
          }}
        >
          <option value="desk">Desk · spacious</option>
          <option value="compact">Ledger · compact</option>
        </select>
      </label>
    </>
  );
}
