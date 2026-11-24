import { CalendarReply } from "./calendar-reply";
import ICAL from "ical.js";
import { useQuery } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
type Component = InstanceType<typeof ICAL.Component>;
function label(event: Component, name: string) {
  const value = event.getFirstPropertyValue(name);
  return typeof value === "string" ? value.slice(0, 512) : "";
}
function time(event: Component, name: string) {
  const property = event.getFirstProperty(name);
  if (!property) return "";
  // Show the sender's wall clock. Reading jCal avoids expanding recurrences or applying an unknown timezone.
  const value: unknown = property.toJSON()[3];
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\dZ?)?$/.test(value))
    throw Error("Invalid event time");
  const instant = value.length === 10 ? value + "T00:00:00Z" : value.replace(/Z?$/, "Z");
  if (
    !Number.isFinite(Date.parse(instant)) ||
    new Date(instant).toISOString().slice(0, 19) !== instant.slice(0, 19)
  )
    throw Error("Invalid event time");
  if (value.length === 10) return value + " (all day)";
  const zone = property.getParameter("tzid");
  return (
    value.replace("T", " ").replace(/Z$/, "") +
    (value.endsWith("Z")
      ? " UTC"
      : typeof zone === "string"
        ? " " + zone.slice(0, 100)
        : " (local time)")
  );
}
function preview(text: string) {
  try {
    const cal = ICAL.Component.fromString(text);
    if (cal.name !== "vcalendar") throw Error();
    const events = cal.getAllSubcomponents("vevent");
    if (!events.length || events.length > 32) throw Error();
    return {
      method: label(cal, "method").toUpperCase(),
      events: events.map((e) => ({
        id: crypto.randomUUID(),
        event: e,
        title: label(e, "summary") || "Untitled event",
        where: label(e, "location"),
        start: time(e, "dtstart"),
        end: time(e, "dtend"),
        recurring: e.hasProperty("rrule"),
      })),
    };
  } catch {
    throw Error("This invitation could not be previewed. You can still download the original.");
  }
}
export default function Calendar({
  path,
  box,
  id,
  edit,
}: {
  path: string;
  box: string;
  id: string;
  edit: boolean;
}) {
  const q = useQuery({
    queryKey: ["calendar", path],
    queryFn: async () =>
      preview(z.object({ calendar: z.string() }).parse(await api(path)).calendar),
  });
  if (q.error) return <p role="alert">{q.error.message}</p>;
  if (!q.data) return <p role="status">Reading invitation…</p>;
  return (
    <section aria-label="Calendar events">
      {q.data.method === "CANCEL" && <p>Event cancellation</p>}
      {q.data.events.map((e) => (
        <article key={e.id}>
          <h3>{e.title}</h3>
          {e.start && <p>Starts {e.start}</p>}
          {e.end && <p>Ends {e.end}</p>}
          {e.where && <p>{e.where}</p>}
          {e.recurring && <p>Recurring event</p>}
          {edit && q.data.method === "REQUEST" && (
            <CalendarReply box={box} id={id} event={e.event} title={e.title} />
          )}
        </article>
      ))}
    </section>
  );
}
