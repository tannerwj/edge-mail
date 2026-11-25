import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, conversationSchema, detailSchema, type Box } from "./api";
import { destination, type MailView } from "./navigation";
import { formatDate, Status } from "./mail-display";
import { MarkOnOpen } from "./mark-on-open";

function InlineReply({ box, id }: { box: Box; id: string }) {
  const q = useQuery({
    queryKey: ["message", box.id, id],
    queryFn: async () => detailSchema.parse(await api("mailboxes/" + box.id + "/messages/" + id)),
  });
  if (!q.data) return <Status error={q.error} />;
  return (
    <>
      {!!box.can_edit && <MarkOnOpen id={id} box={box.id} unread={!q.data.is_read} />}
      <div className="inline-body">{q.data.body || "(No plain-text body)"}</div>
    </>
  );
}
export function Conversation({
  box,
  view,
  message,
}: {
  box: Box;
  view: MailView;
  message: ReturnType<typeof detailSchema.parse>;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const older = useInfiniteQuery({
    queryKey: ["conversation", box.id, message.id, message.conversation_next],
    enabled: false,
    initialPageParam: message.conversation_next || "",
    queryFn: async ({ pageParam }) =>
      conversationSchema.parse(
        await api(
          "mailboxes/" +
            box.id +
            "/conversation/" +
            message.id +
            "?before=" +
            encodeURIComponent(pageParam),
        ),
      ),
    getNextPageParam: (p) => p.conversation_next,
  });
  const rows = [
    ...message.conversation,
    ...(older.data?.pages.flatMap((p) => p.conversation) || []),
  ];
  return (
    <details className="conversation">
      <summary>
        Conversation · {rows.length}
        {(older.data ? older.hasNextPage : message.conversation_next) ? "+" : ""} messages
      </summary>
      {message.latest_unread && message.latest_unread !== message.id && (
        <Link {...destination({ ...view, box: box.id, message: message.latest_unread })}>
          Jump to latest unread
        </Link>
      )}
      {rows.map((r) => (
        <div className="inline-reply" key={r.id}>
          <div>
            <Link
              {...destination({ ...view, box: box.id, message: r.id })}
              aria-current={r.id === message.id ? "page" : undefined}
            >
              {r.subject || "(No subject)"}
              <small>
                {r.sender} · {formatDate(r.received_at)}
              </small>
            </Link>
            {r.id !== message.id && (
              <button
                aria-expanded={expanded.includes(r.id)}
                aria-label={
                  (expanded.includes(r.id) ? "Collapse " : "Expand ") + (r.subject || "message")
                }
                onClick={() =>
                  setExpanded((ids) =>
                    ids.includes(r.id) ? ids.filter((i) => i !== r.id) : [...ids, r.id],
                  )
                }
              >
                {expanded.includes(r.id) ? "Collapse" : "Expand"}
              </button>
            )}
          </div>
          {expanded.includes(r.id) && <InlineReply box={box} id={r.id} />}
        </div>
      ))}
      {(older.data ? older.hasNextPage : message.conversation_next) && (
        <button disabled={older.isFetching} onClick={() => void older.fetchNextPage()}>
          Load earlier replies
        </button>
      )}
      {older.error && <p role="alert">{older.error.message}</p>}
    </details>
  );
}
