import { Link } from "@tanstack/react-router";
import { NewDraft } from "./drafts";
import type { Workspace } from "./api";
const targets = [
  {
    section: "personal",
    id: "color-scheme",
    title: "Color scheme",
    words: "dark mode light mode appearance theme",
  },
  {
    section: "personal",
    id: "reading-layout",
    title: "Reading layout",
    words: "compact spacious ledger density",
  },
  {
    section: "mail",
    id: "vacation-reply",
    title: "Vacation reply",
    words: "out of office automatic reply away autoresponder",
  },
  {
    section: "mail",
    id: "sending-signatures",
    title: "Sending identities and signatures",
    words: "signature sender identity sign off",
  },
  {
    section: "personal",
    id: "read-on-open",
    title: "Mark read when opened",
    words: "automatic read unread shared read state",
  },
  {
    section: "personal",
    id: "keyboard-shortcuts",
    title: "Keyboard shortcuts",
    words: "single key commands",
  },
];
export function settingMatches(needle: string, space: Workspace) {
  const editable = space.mailboxes.some((b) => b.can_edit),
    managed = space.mailboxes.some((b) => b.can_forward);
  return needle
    ? targets.filter(
        (t) =>
          (t.id !== "vacation-reply" || editable) &&
          (t.id !== "sending-signatures" || managed) &&
          (t.title + " " + t.words).toLowerCase().includes(needle),
      )
    : [];
}
export function SettingMatches({
  matches,
  library,
  space,
}: {
  matches: typeof targets;
  library: boolean;
  space: Workspace;
}) {
  const box = space.mailboxes.find((b) => b.can_edit);
  return (
    <nav aria-label="Matching controls" className="setting-matches">
      {matches.map((t) => (
        <Link
          key={t.id}
          to="/settings/$section"
          params={{ section: t.section }}
          hash={t.id}
          hashScrollIntoView={false}
        >
          {t.title}
        </Link>
      ))}
      {library && box && (
        <div>
          Templates and contacts are in the composer. <NewDraft box={box} title="Open composer" />
        </div>
      )}
    </nav>
  );
}
