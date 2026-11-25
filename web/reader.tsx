import { Conversation } from "./conversation";
import { Claim } from "./claim";
import { MarkOnOpen } from "./mark-on-open";
import { RecipientHeader } from "./recipient-header";
import { ArrowLeft, ChevronDown, Printer, Info } from "lucide-react";
import { RuleExplanation } from "./rule-explanation";
import { LeaveList } from "./leave-list";
import { MailAssistant } from "./assistant";
import React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, detailSchema, type Box } from "./api";
import { destination, type MailView } from "./navigation";
import { NewDraft } from "./drafts";
import { Actions } from "./triage";
import { Reminders } from "./reminders";
import { FormattedBody } from "./formatted";
import { Attachments } from "./attachments";
import { Status } from "./mail-display";
function backLabel(view: MailView) {
  return view.view === "unified"
    ? view.domain
      ? "Domain inbox"
      : view.folder === "sent"
        ? "All sent"
        : "All inboxes"
    : view.q
      ? "Search"
      : view.folder
        ? view.folder[0].toUpperCase() + view.folder.slice(1)
        : "Inbox";
}
export function Reader({ box, id, view }: { box: Box; id: string; view: MailView }) {
  const q = useQuery({
    queryKey: ["message", box.id, id],
    queryFn: () =>
      api("mailboxes/" + box.id + "/messages/" + id).then((v) => detailSchema.parse(v)),
  });
  if (!q.data) return <Status error={q.error} />;
  const m = q.data;
  return (
    <article className="mail-reading">
      <div className="reading-toolbar">
        <Link className="back" {...destination({ ...view, box: box.id, message: undefined })}>
          <ArrowLeft size={16} /> {backLabel(view)}
        </Link>
        {!box.can_edit && <small>Read-only mailbox</small>}
        {!!box.can_edit && <MarkOnOpen key={id} id={id} box={box.id} unread={!m.is_read} />}
        <Actions view={view} key={"actions:" + id} box={box} message={m} />
      </div>
      {m.thread && (!!m.thread.shared || !!m.thread.claimed_by) && (
        <Claim box={box} state={m.thread} />
      )}
      {m.thread && <Reminders key={m.thread.thread_id} box={box} state={m.thread} />}
      <div className="letter">
        <h1>{m.subject || "(No subject)"}</h1>
        {m.protection === "signed" && <p>Signed (not verified)</p>}
        {m.protection === "encrypted" && <p>Encrypted, not supported</p>}
        <RecipientHeader m={m} />
        {m.conversation.length > 1 && <Conversation key={id} box={box} view={view} message={m} />}
        <FormattedBody
          key={"formatted:" + m.id}
          box={box.id}
          id={m.id}
          enabled={m.formatted}
          text={m.body}
        />
        {m.attachment_count > 0 && (
          <Attachments
            edit={!!box.can_edit}
            key={"files:" + m.id}
            box={box.id}
            id={m.id}
            count={m.attachment_count}
          />
        )}
        {m.deliveryStatus.length > 0 && (
          <div aria-label="Delivery status">
            {m.deliveryStatus.map((row) => (
              <p key={row.kind}>
                {row.kind === "bounced" || row.kind === "failed" || row.kind === "rejected"
                  ? "Message not delivered"
                  : row.kind.charAt(0).toUpperCase() + row.kind.slice(1)}{" "}
                · {row.recipients} {row.recipients === 1 ? "recipient" : "recipients"}
              </p>
            ))}
          </div>
        )}
        {m.unsubscribeHost && (
          <LeaveList key={m.id} box={box.id} id={m.id} host={m.unsubscribeHost} />
        )}
      </div>
      {!!box.can_edit && (
        <div className="compose-actions">
          {["reply", "reply-all", "forward"].map((mode, i) => (
            <NewDraft
              key={id + mode}
              box={box}
              parent={id}
              mode={mode}
              title={["Reply", "Reply all", "Forward"][i]}
            />
          ))}
        </div>
      )}
      <MessageTools key={id} box={box} m={m} />
    </article>
  );
}

function MessageTools({ box, m }: { box: Box; m: ReturnType<typeof detailSchema.parse> }) {
  const id = m.id;
  return (
    <details key={"tools:" + id} className="message-tools">
      <summary>
        <Info size={15} /> Message tools &amp; details <ChevronDown size={14} />
      </summary>
      <MailAssistant key={"assist:" + id} box={box} id={id} />

      <button className="quiet print-button" onClick={() => window.print()}>
        <Printer size={15} /> Print message
      </button>
      <RuleExplanation key={"why:" + id} box={box.id} id={id} />
      <details>
        <summary>Delivery details</summary>
        {m.screening && <p>{m.screening}</p>}
        {m.deliveries.map((d) => (
          <p key={d.id}>
            {d.envelope_to} · {d.kind}
            <small>
              {Object.entries(JSON.parse(d.auth))
                .map(([k, v]) => k.toUpperCase() + " " + v)
                .join(" · ") || "Authentication unknown"}
            </small>
          </p>
        ))}
      </details>
    </details>
  );
}
