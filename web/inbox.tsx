import { ListActions } from "./list-actions";
import { messagePerson } from "./recipient-header";
import { RefreshCw, Paperclip, UserRoundCheck } from "lucide-react";
import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { api, inboxSchema, type Box, type Workspace } from "./api";
import { destination, type MailView } from "./navigation";
import { MailFilter } from "./mail-search";
import { BulkActions, useSelection } from "./bulk-actions";
import { Reader } from "./reader";
import { ConversationList } from "./conversation-list";
import { useListWidth } from "./pane-divider";
import { MailAssistant } from "./assistant";
import { useMailGestures } from "./gestures";
import { MailCommands } from "./commands";
import { EmptyReader, SenderAvatar, Status, formatDate } from "./mail-display";

const emptyFolders: Record<string, string> = {
  starred: "No starred messages. Star a message to keep it here.",
  archive: "No archived messages. Messages you archive appear here.",
  snoozed: "No snoozed conversations. Choose Snooze in a conversation to bring it back later.",
  unread: "All caught up. No unread messages.",
  sent: "No sent messages yet.",
  spam: "No messages in Spam.",
  trash: "Trash is empty.",
  "follow-ups": "No follow-ups due.",
};
function listHeading(box: Box | undefined, view: MailView, scope: Box[]) {
  const unified = view.view === "unified";
  const title = unified
    ? view.domain
      ? scope[0]?.address.split("@")[1] || "Domain inbox"
      : view.folder === "sent"
        ? "All sent"
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
    queryKey: unified
      ? ["unified-inbox", view.domain, view.q, view.folder]
      : ["inbox", box?.id, view.q, view.folder],
    initialPageParam: "",
    refetchInterval: 15000,
    queryFn: ({ pageParam }) =>
      api(
        unified
          ? "inbox?" +
              new URLSearchParams({
                ...(view.folder ? { folder: view.folder } : {}),
                domain: view.domain || "",
                before: pageParam,
                q: view.q || "",
              })
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
  const person = messagePerson(m);
  const time = new Date(m.received_at);
  return (
    <Link
      {...destination({ ...view, box: target, message: m.id })}
      className={"item " + (selected === m.id ? "selected" : "")}
    >
      <SenderAvatar sender={person} />
      <span className="message-text">
        <span className="row">
          <strong>{person}</strong>
          {mailbox && (
            <small className="row-mailbox" title={mailbox}>
              {mailbox}
            </small>
          )}
          {m.attachment_count > 0 && (
            <span role="img" aria-label={m.attachment_count + " attachments"}>
              <Paperclip size={13} />
            </span>
          )}
          <time dateTime={m.received_at} title={time.toLocaleString()}>
            {formatDate(m.received_at)}
          </time>
        </span>
        <b className={m.is_read ? "" : "unread"}>
          {m.claimed_by && (
            <small className="claim-label" title={"Claimed by " + m.claimed_by}>
              <UserRoundCheck size={13} aria-hidden="true" />
              <span>{m.claimed_by}</span>
            </small>
          )}
          {m.starred ? "★ " : ""}
          {m.subject || "(No subject)"}
          {m.message_count > 1 ? " · " + m.message_count : ""}
        </b>
        <span className="snippet">{m.snippet}</span>
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
        {box && (
          <>
            <MailFilter box={box} view={view} scope={unified ? title : undefined} />
            <div className="list-tools">
              {!unified && <MailAssistant box={box} />}
              {(unified ? scope.some((b) => b.can_edit) : !!box.can_edit) && (
                <BulkActions
                  selection={selection}
                  loaded={messages
                    .filter(
                      (m) => !unified || scope.some((b) => b.id === m.mailbox_id && b.can_edit),
                    )
                    .map((m) => m.id)}
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
              <Link {...destination({ ...view, box: box.id, q: undefined, message: undefined })}>
                Clear search
              </Link>
            </div>
          ) : (
            <p className="empty">{emptyFolders[view.folder || ""] || "No messages yet."}</p>
          )
        ) : (
          <ConversationList rows={messages} selected={selected}>
            {(m) => (
              <InboxRow
                m={m}
                owner={unified ? scope.find((b) => b.id === m.mailbox_id) : box}
                view={view}
                unified={unified}
                selection={selection}
              />
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
          <EmptyReader search={true} />
        ) : null}
      </section>
    </div>
  );
}

function InboxRow({
  m,
  owner,
  view,
  unified,
  selection,
}: {
  m: ReturnType<typeof inboxSchema.parse>["messages"][number];
  owner?: Box;
  view: MailView;
  unified: boolean;
  selection: ReturnType<typeof useSelection>;
}) {
  const row = (
    <ConversationLink
      m={m}
      box={owner}
      view={view}
      mailbox={unified ? owner?.display_name : undefined}
    />
  );
  return (
    <div key={m.id} className="message-row">
      {!!owner?.can_edit && selection.active && (
        <input
          type="checkbox"
          aria-label={"Select message " + (m.subject || "(No subject)")}
          checked={selection.ids.includes(m.id)}
          onChange={() => selection.toggle(m.id)}
        />
      )}
      {owner?.can_edit &&
      !selection.active &&
      !view.q &&
      (view.folder ?? "inbox") === "inbox" &&
      m.folder === "inbox" ? (
        <ListActions box={owner.id} thread={m.thread_id}>
          {row}
        </ListActions>
      ) : (
        row
      )}
    </div>
  );
}
