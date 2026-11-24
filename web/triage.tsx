import { Archive, Search, Star, Mail, MailOpen, Folder } from "lucide-react";
import { parseSearch } from "../src/search";
import { EraseMessage } from "./erasure";
import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { api, type Box } from "./api";
import { destination, type MailView } from "./navigation";
function FilterChips({ box, q }: { box: string; q: string }) {
  const tokens: string[] = [];
  try {
    parseSearch(q, 0, tokens);
  } catch {
    return null;
  }
  return (
    <nav className="search-chips" aria-label="Active search filters">
      {[...new Set(tokens)].map((t) => (
        <Link
          key={t}
          aria-label={"Remove filter " + t}
          {...destination({ box, q: tokens.filter((v) => v !== t).join(" ") || undefined })}
        >
          {t} ×
        </Link>
      ))}
    </nav>
  );
}
export function MailFilter({ box, view }: { box: Box; view: MailView }) {
  const navigate = useNavigate();
  return (
    <>
      <form
        className="mailsearch"
        role="search"
        key={view.q}
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get("q");
          const q = typeof value === "string" ? value.trim() : "";
          void navigate(destination({ box: box.id, q: q || undefined }));
        }}
      >
        <input
          data-shortcut="/"
          type="search"
          aria-label="Search mailbox"
          name="q"
          maxLength={1024}
          placeholder="Search mailbox"
          defaultValue={view.q}
        />
        <button aria-label="Search" title="Search">
          <Search size={16} />
        </button>
      </form>
      {view.q && <FilterChips box={box.id} q={view.q} />}
    </>
  );
}
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
export function Actions({ box, message }: { box: Box; message: Detail }) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (data: { field: string; value: boolean | string }) =>
      data.field === "feedback"
        ? api("mailboxes/" + box.id + "/screening/" + message.id, { spam: data.value })
        : api("mailboxes/" + box.id + "/messages/" + message.id, data),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["inbox", box.id] }),
        client.invalidateQueries({ queryKey: ["unified-inbox"] }),
        client.invalidateQueries({ queryKey: ["message", box.id, message.id] }),
      ]);
    },
  });
  const [label, setLabel] = useState("");
  const change = (field: string, value: string | boolean) => save.mutate({ field, value });
  return (
    <div className="actions">
      {!!box.can_edit && (
        <fieldset disabled={save.isPending}>
          <legend>Organize message</legend>
          <TriageButtons message={message} change={change} />
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
      {save.error && <p role="alert">{save.error.message}</p>}
    </div>
  );
}

export function Appearance() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || "desk");
  const [color, setColor] = useState(document.documentElement.dataset.color || "system");
  return (
    <>
      <label className="appearance">
        <input
          type="checkbox"
          defaultChecked={localStorage.getItem("edge-mail-shortcuts") !== "off"}
          onChange={(e) =>
            localStorage.setItem("edge-mail-shortcuts", e.target.checked ? "on" : "off")
          }
        />{" "}
        Single-key mailbox shortcuts
      </label>
      <label className="appearance">
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
      <label className="appearance">
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
