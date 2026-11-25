import { Mail, Inbox } from "lucide-react";
import React from "react";
export function formatDate(value: string) {
  const time = new Date(value),
    today = new Date();
  if (time.toDateString() === today.toDateString())
    return time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return time.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: time.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}
export function Status({ error }: { error: Error | null }) {
  return <p role="status">{error?.message || "Loading…"}</p>;
}

export function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <Mail size="1em" strokeWidth={1.7} />
    </span>
  );
}

export function SenderAvatar({ sender }: { sender: string }) {
  const local = sender.split("@")[0] || "?";
  const initials = local
    .split(/[._+ -]+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return (
    <span aria-hidden="true" className={"sender-avatar tint-" + (local.charCodeAt(0) % 5)}>
      {initials}
    </span>
  );
}

export function EmptyReader({ search }: { search: boolean }) {
  return (
    <div className="placeholder">
      <span className="reader-symbol">
        <Inbox size={35} strokeWidth={1.35} />
      </span>
      <h2>Select a conversation</h2>
      <p>Choose a message from the list to read it.</p>
      {localStorage.getItem("edge-mail-shortcuts") !== "off" && (
        <div className="reader-hints">
          <span>
            <kbd>J</kbd> <kbd>K</kbd> Navigate
          </span>
          {search && (
            <span>
              <kbd>/</kbd> Search
            </span>
          )}
        </div>
      )}
    </div>
  );
}
