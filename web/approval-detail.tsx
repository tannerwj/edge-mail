import * as z from "zod/mini";
const mail = z.object({
  to: z.array(z.string()),
  cc: z.array(z.string()),
  bcc: z.array(z.string()),
  body: z.string(),
  attachments: z.optional(z.array(z.string())),
});
const hook = z.object({ url: z.string(), events: z.array(z.string()) });
const rule = z.object({
  edit: z.object({
    document: z.object({
      name: z.string(),
      condition: z.unknown(),
      actions: z.array(
        z.object({
          kind: z.string(),
          text: z.optional(z.string()),
          mode: z.optional(z.string()),
          destination: z.optional(z.string()),
        }),
      ),
    }),
  }),
});
export function ApprovalDetail({ data }: { data: unknown }) {
  const message = mail.safeParse(data);
  if (message.success) {
    const m = message.data;
    return (
      <>
        <p>To {m.to.join(", ")}</p>
        {m.cc.length > 0 && <p>Cc {m.cc.join(", ")}</p>}
        {m.bcc.length > 0 && <p>Bcc {m.bcc.join(", ")}</p>}
        <pre className="body">{m.body}</pre>
        {!!m.attachments?.length && <p>Attachments · {m.attachments.join(", ")}</p>}
      </>
    );
  }
  const receiver = hook.safeParse(data);
  if (receiver.success)
    return (
      <>
        <p>
          Send these events to <code>{receiver.data.url}</code>
        </p>
        <p>{receiver.data.events.join(", ")}</p>
      </>
    );
  const edit = rule.safeParse(data);
  if (edit.success) {
    const d = edit.data.edit.document;
    return (
      <>
        <p>
          When mail matches <code>{JSON.stringify(d.condition)}</code>
        </p>
        {d.actions.map((a) => (
          <p key={JSON.stringify(a)}>
            {a.kind.replaceAll("_", " ")} {a.mode} {a.destination} {a.text}
          </p>
        ))}
      </>
    );
  }
  return <p>Review details unavailable.</p>;
}
