import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { api, inboxSchema, type Box, type Workspace } from "./api";
import { destination, type MailView } from "./navigation";
import { MailFilter } from "./triage";
import { BulkActions, useSelection } from "./bulk-actions";
import { Reader } from "./reader";
import { ConversationList } from "./conversation-list";
import { useListWidth } from "./pane-divider";
import { MailAssistant } from "./assistant";
import { useMailGestures } from "./gestures";
import { MailCommands } from "./commands";
import { EmptyReader, SenderAvatar, Status, formatDate } from "./mail-display";

function listHeading(box: Box | undefined, view: MailView, scope: Box[]) {
  const unified = view.view === "unified";
  const title = unified
    ? view.domain
      ? scope[0]?.address.split("@")[1] || "Domain inbox"
      : "All inboxes"
    : view.q
      ? "Search results"
      : (view.folder || "Inbox").replace(/^./, (c) => c.toUpperCase());
  const caption = unified
    ? scope.length +
      (scope.length === 1 ? " mailbox" : " mailboxes") +
      " · " +
      scope.reduce((n, b) => n + (b.unread || 0), 0) +
      " unread"
    : box?.display_name;
  return { title, caption };
}
function useConversations(box: Box | undefined, view: MailView, unified: boolean) {
  return useInfiniteQuery({
    queryKey: unified ? ["unified-inbox", view.domain] : ["inbox", box?.id, view.q, view.folder],
    initialPageParam: "",
    refetchInterval: 15000,
    queryFn: ({ pageParam }) =>
      api(
        unified
          ? "inbox?" + new URLSearchParams({ domain: view.domain || "", before: pageParam })
          : "mailboxes/" +
              box?.id +
              "/messages?group=thread&before=" +
              encodeURIComponent(pageParam) +
              (view.q ? "&q=" + encodeURIComponent(view.q) : "") +
              (view.folder ? "&folder=" + encodeURIComponent(view.folder) : ""),
      ).then((v) => inboxSchema.parse(v)),
    getNextPageParam: (page) => page.next,
  });
}
function ConversationLink({
  m,
  box,
  view,
  mailbox,
}: {
  m: ReturnType<typeof inboxSchema.parse>["messages"][number];
  box?: Box;
  view: MailView;
  mailbox?: string;
}) {
  const selected = view.message;
  const target = m.mailbox_id || box?.id;
  if (!target) return null;
  return (
    <Link
      {...destination({ ...view, box: target, message: m.id })}
      className={"item " + (selected === m.id ? "selected" : "")}
    >
      <SenderAvatar sender={m.sender} />
      <span className="message-text">
        <span className="row">
          <strong>{m.sender || "Unknown sender"}</strong>
          <time>{formatDate(m.received_at)}</time>
        </span>
        <b className={m.is_read ? "" : "unread"}>
          {m.starred ? "★ " : ""}
          {m.subject || "(No subject)"}
          {m.message_count > 1 ? " · " + m.message_count : ""}
        </b>
        <span className="snippet">
          {mailbox ? mailbox + " · " : ""}
          {m.snippet}
        </span>
      </span>
    </Link>
  );
}
export function Inbox({ box, view, space }: { box?: Box; view: MailView; space: Workspace }) {
  const unified = view.view === "unified";
  const scope = space.mailboxes.filter((b) => !view.domain || b.domain_id === view.domain);
  const { title, caption } = listHeading(box, view, scope);
  const selection = useSelection();
  const navigate = useNavigate(),
    pane = useListWidth();
  const selected = view.message;
  const q = useConversations(box, view, unified);
  const gestures = useMailGestures(() => void q.refetch());
  const messages = useMemo(() => q.data?.pages.flatMap((p) => p.messages) || [], [q.data]);
  async function moveMessage(direction: number) {
    const index = Math.max(0, messages.findIndex((m) => m.id === selected) + direction);
    const next =
      messages[index] ??
      (q.hasNextPage && index === messages.length
        ? (await q.fetchNextPage()).data?.pages.at(-1)?.messages[0]
        : undefined);
    const target = next?.mailbox_id || box?.id;
    if (next && target) await navigate(destination({ ...view, box: target, message: next.id }));
  }
  return (
    <div
      data-list-width={pane.width}
      {...gestures}
      className={"panes " + (selected ? "reading" : "")}
    >
      <section className="list" id="mail-conversations">
        <header>
          <div>
            <small>
              {caption}
              {!unified && box && !box.can_edit && " · Read-only mailbox"}
            </small>
            <h1>{title}</h1>
          </div>
          <div className="list-toolbar">
            <MailCommands move={(direction) => void moveMessage(direction)} />
            <button className="quiet" onClick={() => void q.refetch()} aria-label="Refresh inbox">
              <RefreshCw size={15} />
            </button>
          </div>
        </header>
        {!unified && box && (
          <>
            <MailFilter box={box} view={view} />
            <div className="list-tools">
              <MailAssistant box={box} />
              {!!box.can_edit && (
                <BulkActions
                  box={box.id}
                  selection={selection}
                  loaded={messages.map((m) => m.id)}
                />
              )}
            </div>
          </>
        )}
        {!q.data ? (
          <Status error={q.error} />
        ) : !messages.length ? (
          view.q && box ? (
            <div className="empty">
              <p>No messages match this search.</p>
              <Link {...destination({ box: box.id })}>Clear search</Link>
            </div>
          ) : (
            <p className="empty">No messages yet.</p>
          )
        ) : (
          <ConversationList rows={messages} selected={selected}>
            {(m) => (
              <div key={m.id} className="message-row">
                {!unified && !!box?.can_edit && selection.active && (
                  <input
                    type="checkbox"
                    aria-label={"Select message " + (m.subject || "(No subject)")}
                    checked={selection.ids.includes(m.id)}
                    onChange={() => selection.toggle(m.id)}
                  />
                )}
                <ConversationLink
                  m={m}
                  box={box}
                  view={view}
                  mailbox={
                    unified ? scope.find((b) => b.id === m.mailbox_id)?.display_name : undefined
                  }
                />
              </div>
            )}
          </ConversationList>
        )}
        {q.hasNextPage && (
          <button className="quiet" onClick={() => void q.fetchNextPage()}>
            Load older messages
          </button>
        )}
      </section>
      {pane.divider}
      <section className="reader">
        {selected && box ? (
          <Reader box={box} id={selected} view={view} />
        ) : messages.length > 0 ? (
          <EmptyReader search={!unified} />
        ) : null}
      </section>
    </div>
  );
}
