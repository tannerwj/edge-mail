import type { MailView } from "./navigation";
import { Layers, Globe, Send, FilePenLine, Timer } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Workspace } from "./api";
function domains(space: Workspace) {
  const groups = new Map<string, { name: string; unread: number }>();
  for (const box of space.mailboxes) {
    const name = box.address.split("@")[1],
      id = box.domain_id;
    groups.set(id, { name, unread: (groups.get(id)?.unread || 0) + (box.unread || 0) });
  }
  return groups;
}
export function WorkspaceInboxes({ space, view }: { space: Workspace; view: MailView }) {
  const groups = domains(space);
  const selected = view.view === "unified" ? view.domain : undefined;
  if (!space.mailboxes.length) return null;
  return (
    <>
      <Link
        to="/inboxes"
        data-selected={(view.view === "unified" && !selected && !view.folder) || undefined}
      >
        <Layers size={16} />
        All inboxes
      </Link>
      {(
        [
          ["drafts", "All drafts", FilePenLine],
          ["scheduled", "All scheduled", Timer],
          ["sent", "All sent", Send],
        ] as const
      )
        .filter(([f]) => f === "sent" || space.mailboxes.some((b) => b.can_edit))
        .map(([f, label, Icon]) => (
          <Link
            key={f}
            to={"/inboxes/" + f}
            data-selected={(view.view === "unified" && view.folder === f) || undefined}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      <details key={selected} open={!!selected}>
        <summary>
          <Globe size={16} />
          By domain
        </summary>
        {[...groups].map(([domain, g]) => (
          <Link
            data-selected={domain === selected || undefined}
            key={domain}
            to="/domains/$domain/inbox"
            params={{ domain }}
          >
            {g.name} · {g.unread} unread
          </Link>
        ))}
      </details>
    </>
  );
}
