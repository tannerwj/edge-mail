import { useNavigate } from "@tanstack/react-router";
import { useDraftLink } from "./navigation";
import { Clock3, Send } from "lucide-react";
import { FolderEmpty, MailFolder } from "./mail-folder";
import React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api, type Box } from "./api";
const schema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      state: z.string(),
      can_reopen: z.optional(z.number()),
      awaiting_approval: z.optional(z.number()),
      due_ms: z.number(),
      scheduled_for: z.nullable(z.number()),
      error_code: z.nullable(z.string()),
      provider: z.string(),
    }),
  ),
});
function deliveryLabel(item: z.infer<typeof schema>["items"][number]) {
  if (item.awaiting_approval) return "Awaiting your approval";
  if (item.state === "held") return item.scheduled_for ? "Scheduled" : "Waiting to send";
  if (item.state === "uncertain") return "May have been sent";
  if (item.state === "sent" && item.provider === "capture") return "Captured";
  if (item.state === "deferred") return "Delivery delayed";
  if (item.state === "claimed") return "Sending";
  return item.state;
}
export function Outbox({ box, scheduled = false }: { box: Box; scheduled?: boolean }) {
  const navigate = useNavigate(),
    link = useDraftLink();
  const path = "mailboxes/" + box.id + "/outbox";
  const q = useQuery({
    queryKey: ["outbox", box.id, scheduled],
    queryFn: async () => schema.parse(await api(scheduled ? path + "/scheduled" : path)),
    refetchInterval: (query) => {
      const due = query.state.data?.items
        .filter((i) => ["held", "deferred", "claimed"].includes(i.state))
        .map((i) => i.due_ms);
      return due?.length ? Math.max(2000, Math.min(60000, Math.min(...due) - Date.now())) : false;
    },
  });
  const undo = useMutation({
    mutationFn: async (item: z.infer<typeof schema>["items"][number]) => {
      const result = await api(path + "/" + item.id, {
        action: item.can_reopen ? "undo" : "cancel",
      });
      if (item.can_reopen)
        await navigate(link(box.id, z.object({ id: z.string() }).parse(result).id));
      await q.refetch();
    },
  });
  const Icon = scheduled ? Clock3 : Send;
  return (
    <MailFolder title={scheduled ? "Scheduled" : "Outbox"} icon={Icon} mailbox={box.display_name}>
      {undo.error && <p role="alert">{undo.error.message}</p>}
      {!q.data ? (
        <p role="status">{q.error?.message || "Loading…"}</p>
      ) : q.data.items.length === 0 ? (
        <FolderEmpty
          title={scheduled ? "No scheduled messages" : "Your outbox is empty"}
          icon={Icon}
        >
          {scheduled
            ? "Use Send later in a draft to choose a delivery time."
            : "Messages appear here after you send them. Check their status or undo a pending send."}
        </FolderEmpty>
      ) : (
        q.data.items.map((i) => (
          <div key={i.id} className="queue-row">
            <Icon size={18} />
            <div>
              <strong>{i.subject}</strong>
              <p>{deliveryLabel(i)}</p>
              {i.state === "held" && !!i.scheduled_for && (
                <time dateTime={new Date(i.scheduled_for).toISOString()}>
                  {" "}
                  Scheduled for {new Date(i.scheduled_for).toLocaleString()}
                </time>
              )}
              {i.error_code && <small>{i.error_code}</small>}
            </div>
            {(["held", "deferred"].includes(i.state) ||
              (i.state === "cancelled" && i.error_code === "user_undo" && i.can_reopen === 1)) && (
              <button disabled={undo.isPending} onClick={() => undo.mutate(i)}>
                {i.state === "cancelled"
                  ? "Open restored draft"
                  : i.scheduled_for
                    ? "Cancel scheduled send"
                    : "Undo send"}
              </button>
            )}
          </div>
        ))
      )}
    </MailFolder>
  );
}
