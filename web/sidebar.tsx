import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  Clock3,
  FilePenLine,
  Folder,
  Inbox,
  LogOut,
  MailOpen,
  Menu,
  Send,
  Settings,
  ShieldAlert,
  SquarePen,
  Star,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import type { Box, Session, Workspace } from "./api";
import { destination, type MailView } from "./navigation";
import { NewDraft } from "./drafts";
import { Mark } from "./mail-display";
import { WorkspaceInboxes } from "./unified";
import { ApprovalsLink } from "./approvals";
import { SearchBookmarks } from "./search-bookmarks";
import { signOut } from "./offline";

const folders = [
  ["Inbox", Inbox],
  ["Unread", MailOpen],
  ["Starred", Star],
  ["Drafts", FilePenLine],
  ["Sent", Send],
  ["Scheduled", Timer],
  ["Outbox", Folder],
  ["Snoozed", Clock3],
  ["Follow-ups", Clock3],
  ["Archive", Archive],
  ["Spam", ShieldAlert],
  ["Trash", Trash2],
] as const;
function FolderLinks({ box, view }: { box: Box; view: MailView }) {
  return (
    <nav className="folder-menu" aria-label="Folders">
      {folders.map(([name, Icon]) => {
        const folder = name.toLowerCase();
        if (!box.can_edit && ["drafts", "scheduled", "outbox"].includes(folder)) return null;
        return (
          <Link
            key={folder}
            {...destination({ box: box.id, folder })}
            data-selected={
              (!view.view && !view.q && folder === (view.folder || "inbox")) || undefined
            }
            aria-current={
              !view.view && !view.q && folder === (view.folder || "inbox") ? "page" : undefined
            }
          >
            <Icon size={16} aria-hidden="true" />
            {name}
          </Link>
        );
      })}
    </nav>
  );
}
type Props = { space: Workspace; session: Session; box?: Box; view: MailView };
export function Sidebar({ space, session, box, view }: Props) {
  const [open, setOpen] = useState(false),
    toggle = useRef<HTMLButtonElement>(null);
  return (
    <aside
      className="mail-sidebar"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <div className="brand-bar">
        <Link to="/app" className="wordmark">
          <Mark />
          Edge Mail
        </Link>
        <button
          className="mobile-menu"
          ref={toggle}
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="side-navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {!!box?.can_edit && (
        <div className="compose-launch">
          <SquarePen size={16} aria-hidden="true" />
          <NewDraft box={box} title="Compose" />
        </div>
      )}
      <div
        id="side-navigation"
        className={open ? "side-content expanded" : "side-content"}
        onClick={(e) => {
          if (e.target instanceof Element && e.target.closest("a, [data-shortcut=c]"))
            setOpen(false);
        }}
      >
        <div className="side-scroll">
          <nav className="workspace-nav" aria-label="Mailboxes">
            <h2>Workspace</h2>
            <WorkspaceInboxes space={space} view={view} />
            <ApprovalsLink />
            {space.mailboxes.map((b) => (
              <Link
                key={b.id}
                {...destination({ box: b.id })}
                className="mailbox-choice"
                title={b.address}
              >
                <span className="box-dot" />
                <span>
                  {b.display_name}
                  <small>{b.address}</small>
                </span>
                {!!b.unread && <b aria-label={b.unread + " unread"}>{b.unread}</b>}
              </Link>
            ))}
          </nav>
          {box && (
            <>
              <h2>Folders</h2>
              <FolderLinks box={box} view={view} />
              <SearchBookmarks box={box.id} query={view.q} />
            </>
          )}
        </div>
        <footer>
          <Link to="/settings" aria-current={view.view === "settings" ? "page" : undefined}>
            <Settings size={16} />
            Settings
          </Link>
          <div className="profile">
            <span className="profile-initial">{session.email[0]?.toUpperCase()}</span>
            <small title={session.email}>{session.email}</small>
            <button
              className="icon-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={() => void signOut()}
            >
              <LogOut size={15} />
            </button>
          </div>
        </footer>
      </div>
    </aside>
  );
}
