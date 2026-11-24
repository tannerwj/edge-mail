import React, { lazy, Suspense, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
const Calendar = lazy(() => import("./calendar"));
const list = z.object({
  files: z.array(
    z.object({
      part: z.number(),
      name: z.string(),
      size: z.number(),
      risk: z.boolean(),
      preview: z.optional(z.nullable(z.string())),
      calendar: z.optional(z.boolean()),
    }),
  ),
});
const link = z.object({ href: z.string() });
export function Attachments({
  box,
  id,
  count,
  edit,
}: {
  box: string;
  id: string;
  count: number;
  edit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const path = "mailboxes/" + box + "/attachments/" + id;
  const q = useQuery({
    queryKey: ["attachments", box, id],
    enabled: open,
    queryFn: async () => list.parse(await api(path)),
  });
  const download = useMutation({
    mutationFn: async (n: number) => {
      const { href } = link.parse(await api(path + "?part=" + n));
      const url = new URL(href);
      if (!["http:", "https:"].includes(url.protocol) || url.origin === location.origin)
        throw Error("Invalid download origin");
      location.assign(url.href);
    },
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Attachments · {count}</summary>
      {(q.error || download.error) && <p role="alert">{(q.error || download.error)?.message}</p>}
      {open && q.isLoading && <p role="status">Reading attachments…</p>}
      {q.data?.files.map((f) => (
        <div key={f.part}>
          <button
            className="quiet"
            disabled={download.isPending}
            onClick={() => download.mutate(f.part)}
          >
            Download {f.name}
          </button>{" "}
          <small>
            {f.size.toLocaleString()} bytes{f.risk ? " · Potentially unsafe file" : ""}
          </small>
          {f.preview && (
            <FilePreview
              path={"mailboxes/" + box + "/preview/" + id + "?part=" + f.part}
              name={f.name}
            />
          )}
          {(f.calendar ?? /\.ics$/i.test(f.name)) && (
            <CalendarPreview
              box={box}
              id={id}
              edit={edit}
              path={"mailboxes/" + box + "/calendar/" + id + "?part=" + f.part}
            />
          )}
        </div>
      ))}
    </details>
  );
}

function CalendarPreview({
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
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Calendar invitation</summary>
      {open && (
        <Suspense fallback={<p role="status">Reading invitation…</p>}>
          <Calendar path={path} box={box} id={id} edit={edit} />
        </Suspense>
      )}
    </details>
  );
}

function FilePreview({ path, name }: { path: string; name: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["file-preview", path],
    enabled: open,
    staleTime: 0,
    refetchInterval: open ? 240000 : false,
    queryFn: async () => {
      const url = new URL(link.parse(await api(path)).href);
      if (!["https:", "http:"].includes(url.protocol) || url.origin === location.origin)
        throw Error("Invalid preview origin");
      return url.href;
    },
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Preview {name}</summary>
      {q.error && <p role="alert">{q.error.message}</p>}
      {q.isLoading && <p role="status">Preparing preview…</p>}
      {open && q.data && (
        <a href={q.data} rel="noopener noreferrer" target="_blank">
          Open {name} in a new tab
        </a>
      )}
    </details>
  );
}
