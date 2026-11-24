import { useLocation, useParams, useSearch } from "@tanstack/react-router";
export type MailView = {
  draft?: string;
  box?: string;
  message?: string;
  view?: "settings" | "unified" | "domain-setup" | "approvals";
  domain?: string;
  section?: string;
  folder?: string;
  q?: string;
};

declare module "@tanstack/react-router" {
  interface HistoryState {
    composeBehind?: MailView;
    composeShortcut?: string;
  }
}
export const allMessageRoute = "/inboxes/$box/messages/$message";
export const domainMessageRoute = "/domains/$domain/inbox/$box/messages/$message";
export const folderRoute = "/mailboxes/$box/$folder";
export const messageRoute = "/mailboxes/$box/$folder/messages/$message";
export const searchRoute = "/mailboxes/$box/search/$term";
export const searchMessageRoute = "/mailboxes/$box/search/$term/messages/$message";
export const draftRoute = "/mailboxes/$box/drafts/$draft";

export function destination(view: MailView & { box: string }) {
  const { box, draft, message, q } = view;
  const folder = view.folder || (q ? "search" : "inbox");
  const search = {};
  if (draft) return { to: draftRoute, params: { box, draft }, search: {} };
  if (view.view === "unified") {
    if (view.domain)
      return message
        ? { to: domainMessageRoute, params: { domain: view.domain, box, message }, search }
        : { to: "/domains/$domain/inbox", params: { domain: view.domain }, search };
    return message
      ? { to: allMessageRoute, params: { box, message }, search }
      : { to: "/inboxes", search };
  }
  if (q) {
    const term = "~" + q;
    return message
      ? { to: searchMessageRoute, params: { box, term, message }, search }
      : { to: searchRoute, params: { box, term }, search };
  }
  if (message) return { to: messageRoute, params: { box, folder, message }, search };
  return { to: folderRoute, params: { box, folder }, search };
}

export function useMailLocation() {
  const params: MailView & { term?: string } = useParams({ strict: false });
  const search: MailView = useSearch({ strict: false });
  const pathname = useLocation({ select: (location) => location.pathname });
  const entry = ["/", "/app", "/setup"].includes(pathname);
  const location: MailView = entry
    ? search
    : {
        ...params,
        q: params.term?.startsWith("~") ? params.term.slice(1) : search.q,
        folder: pathname.endsWith("/drafts")
          ? "drafts"
          : params.folder === "search"
            ? undefined
            : params.folder,
        view:
          pathname.startsWith("/domains/") && pathname.endsWith("/setup")
            ? "domain-setup"
            : pathname === "/approvals"
              ? "approvals"
              : pathname === "/settings" || pathname.startsWith("/settings/")
                ? "settings"
                : pathname.startsWith("/inboxes") || pathname.startsWith("/domains/")
                  ? "unified"
                  : undefined,
      };
  return { entry, location, legacySearch: !entry && !!params.box && !params.term && !!search.q };
}

export function useDraftLink() {
  const { location } = useMailLocation();
  const behind = useLocation({ select: (l) => l.state.composeBehind });
  return (box: string, draft: string, shortcut?: string) => ({
    ...destination({ box, draft }),
    replace: !!location.draft,
    state: { composeBehind: location.draft ? behind : location, composeShortcut: shortcut },
  });
}
