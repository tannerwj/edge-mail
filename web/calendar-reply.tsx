import ICAL from "ical.js";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ulid } from "ulid";
import * as z from "zod/mini";
import { api } from "./api";
import { uploadDraftFile } from "./compose-files";
import { useDraftLink } from "./navigation";
type Event = InstanceType<typeof ICAL.Component>;
const answers = { ACCEPTED: "Accept", TENTATIVE: "Tentative", DECLINED: "Decline" } as const;
type Answer = keyof typeof answers;
function mailbox(value: unknown) {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const match = /^mailto:([^\s<>@,;:?&#]+@[^\s<>@,;:?&#]+\.[^\s<>@,;:?&#]+)$/i.exec(value);
  return match?.[1].toLowerCase() || null;
}
function invite(event: Event, identities: string[]) {
  const organizer = mailbox(event.getFirstPropertyValue("organizer"));
  const recipients = new Set(
    event.getAllProperties("attendee").map((p) => mailbox(p.getFirstValue())),
  );
  const from = identities.find((identity) => recipients.has(identity));
  const uid = event.getFirstPropertyValue("uid");
  if (
    !from ||
    !organizer ||
    event.getAllProperties("organizer").length !== 1 ||
    event.getAllProperties("uid").length !== 1 ||
    typeof uid !== "string" ||
    !uid ||
    uid.length > 512 ||
    /[\p{Cc}]/u.test(uid)
  )
    return null;
  return { organizer, from, uid };
}
function replyFile(
  event: Event,
  who: { organizer: string; from: string; uid: string },
  answer: Answer,
) {
  const cal = new ICAL.Component("vcalendar"),
    reply = new ICAL.Component("vevent");
  cal.addPropertyWithValue("prodid", "-//Edge Mail//Calendar//EN");
  cal.addPropertyWithValue("version", "2.0");
  cal.addPropertyWithValue("method", "REPLY");
  cal.addSubcomponent(reply);
  reply.addPropertyWithValue("uid", who.uid);
  reply.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  const seq = event.getFirstPropertyValue("sequence");
  if (typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0)
    reply.addPropertyWithValue("sequence", seq);
  const recurrence = event.getFirstProperty("recurrence-id");
  if (recurrence) reply.addProperty(new ICAL.Property(recurrence.toJSON()));
  reply.addPropertyWithValue("organizer", "mailto:" + who.organizer);
  reply.addPropertyWithValue("attendee", "mailto:" + who.from).setParameter("partstat", answer);
  return new File([cal.toString() + "\r\n"], "event-reply.ics", { type: "text/calendar" });
}
export function CalendarReply({
  box,
  id,
  event,
  title,
}: {
  box: string;
  id: string;
  event: Event;
  title: string;
}) {
  const draftLink = useDraftLink();
  const navigate = useNavigate(),
    draft = useRef(""),
    [answer, setAnswer] = useState<Answer>("ACCEPTED");
  const q = useQuery({
    queryKey: ["rsvp-identities", box],
    queryFn: async () =>
      z.array(z.object({ from: z.string() })).parse(await api("mailboxes/" + box + "/identities")),
  });
  const who = invite(
    event,
    (q.data || []).map((v) => v.from),
  );
  const create = useMutation({
    mutationFn: async () => {
      if (!who) throw Error("This identity is unavailable");
      draft.current ||= ulid();
      const path = "mailboxes/" + box + "/drafts",
        key = draft.current;
      const state = z
        .object({ revision: z.number() })
        .parse(await api(path, { id: key, parent: id, mode: "reply" }));
      if (state.revision > 1) return navigate(draftLink(box, key));
      const file = replyFile(event, who, answer),
        part = await uploadDraftFile(box, key, file);
      const subject = title.replace(/[\p{Cc}]/gu, " ").slice(0, 250);
      const summary = { ACCEPTED: "Accepted", TENTATIVE: "Tentative", DECLINED: "Declined" }[
        answer
      ];
      await api(path + "/" + key, {
        revision: state.revision,
        content: {
          from: who.from,
          to: who.organizer,
          cc: "",
          bcc: "",
          subject: summary + ": " + subject,
          body: summary + " · " + subject,
          files: [{ ...part, calendar: "reply" }],
        },
      });
      await navigate(draftLink(box, key));
    },
  });
  if (!who) return null;
  return (
    <fieldset disabled={create.isPending}>
      <legend>Respond to organizer</legend>
      <p>
        {who.from} → {who.organizer}
      </p>
      <label>
        Your response
        <select
          value={answer}
          onChange={(e) => {
            const next = e.target.value;
            if (next === "ACCEPTED" || next === "TENTATIVE" || next === "DECLINED") setAnswer(next);
          }}
        >
          {Object.entries(answers).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <button onClick={() => create.mutate()}>Review calendar reply</button>
      {create.error && <p role="alert">{create.error.message}</p>}
    </fieldset>
  );
}
