import { Clock3, FilePenLine } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api, type Box } from "./api";
import { useDraftLink } from "./navigation";
import { FolderEmpty, MailFolder } from "./mail-folder";

const item = z.object({
  id: z.string(),
  mailbox_id: z.string(),
  subject: z.string(),
  stamp: z.union([z.number(), z.string()]),
  recipient: z.optional(z.string()),
  reopen: z.optional(z.number()),
});
const page = z.object({ items: z.array(item), next: z.nullable(z.string()) });
export function CombinedWork({ folder, boxes }: { folder: "drafts" | "scheduled"; boxes: Box[] }) {
  const drafts = folder === "drafts",
    title = drafts ? "All drafts" : "All scheduled",
    Icon = drafts ? FilePenLine : Clock3;
  const link = useDraftLink(),
    navigate = useNavigate();
  const list = useInfiniteQuery({
    queryKey: [drafts ? "drafts" : "outbox", "combined"],
    initialPageParam: "",
    queryFn: async ({ pageParam }) =>
      page.parse(await api("inboxes/" + folder + "?before=" + encodeURIComponent(pageParam))),
    getNextPageParam: (p) => p.next,
    refetchInterval: 15000,
  });
  const cancel = useMutation({
    mutationFn: async (i: z.infer<typeof item>) => {
      const result = await api("mailboxes/" + i.mailbox_id + "/outbox/" + i.id, {
        action: i.reopen ? "undo" : "cancel",
      });
      await list.refetch();
      if (i.reopen)
        await navigate(link(i.mailbox_id, z.object({ id: z.string() }).parse(result).id));
    },
  });
  const rows = list.data?.pages.flatMap((p) => p.items);
  return (
    <MailFolder title={title} mailbox="Across your mailboxes" icon={Icon}>
      {(list.error || cancel.error) && <p role="alert">{(list.error || cancel.error)?.message}</p>}
      {!rows && !list.error && <p role="status">Loading…</p>}
      {rows?.length === 0 && (
        <FolderEmpty title={drafts ? "No drafts yet" : "No scheduled messages"} icon={Icon}>
          {drafts ? "Choose Compose to start a message." : "Use Send later while composing."}
        </FolderEmpty>
      )}
      {rows?.map((i) => {
        const label = boxes.find((b) => b.id === i.mailbox_id)?.display_name;
        const contents = (
          <>
            <Icon size={18} />
            <div>
              <strong>{i.subject || "Untitled draft"}</strong>
              <small>
                {label}
                {i.recipient && " · " + i.recipient}
              </small>
            </div>
            <time>{new Date(i.stamp).toLocaleString()}</time>
          </>
        );
        return drafts ? (
          <Link key={i.id} className="queue-row" {...link(i.mailbox_id, i.id)}>
            {contents}
          </Link>
        ) : (
          <div key={i.id} className="queue-row">
            {contents}
            <button disabled={cancel.isPending} onClick={() => cancel.mutate(i)}>
              Cancel scheduled send
            </button>
          </div>
        );
      })}
      {list.hasNextPage && (
        <button disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          Load more
        </button>
      )}
    </MailFolder>
  );
}
