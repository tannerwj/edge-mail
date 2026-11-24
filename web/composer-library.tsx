import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
const contact = z.object({ name: z.string(), address: z.string() });
const template = z.object({
  id: z.string(),
  name: z.string(),
  body: z.string(),
  subject: z.string(),
  rich: z.number(),
});
const contents = z.object({ contacts: z.array(contact), templates: z.array(template) });
type Template = z.infer<typeof template>;
type Content = { subject: string; body: string; rich?: boolean };
function useLibrary(box: string, q = "") {
  return useQuery({
    queryKey: ["compose-library", box, q],
    queryFn: async () =>
      contents.parse(await api("mailboxes/" + box + "/library?q=" + encodeURIComponent(q))),
  });
}
export function ComposerLibrary({
  box,
  content,
  apply,
}: {
  box: string;
  content: Content;
  apply: (t: Template) => void;
}) {
  const client = useQueryClient(),
    q = useLibrary(box),
    [pick, setPick] = useState("");
  const current = q.data?.templates.find((t) => t.id === pick);
  const save = useMutation({
    mutationFn: (data: object) => api("mailboxes/" + box + "/library", data),
    onSuccess: () => client.invalidateQueries({ queryKey: ["compose-library", box] }),
  });
  return (
    <details>
      <summary>Templates and contacts</summary>
      <label>
        Saved template
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choose a template</option>
          {q.data?.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {current && (
        <>
          <strong>{current.subject}</strong>
          <p>{current.body}</p>
          <button type="button" onClick={() => apply(current)}>
            Use template in draft
          </button>
          <button
            type="button"
            onClick={() => save.mutate({ action: "template_remove", id: pick })}
          >
            Delete template
          </button>
        </>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          save.mutate(
            { action: "template_save", name: new FormData(form).get("name"), ...content },
            { onSuccess: () => form.reset() },
          );
        }}
      >
        <label>
          Name this draft as a template
          <input name="name" maxLength={80} required />
        </label>
        <button disabled={save.isPending || !content.body.trim()}>Save template</button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          save.mutate(
            { action: "contact_save", ...Object.fromEntries(new FormData(form)) },
            { onSuccess: () => form.reset() },
          );
        }}
      >
        <label>
          Contact name
          <input name="name" maxLength={100} required />
        </label>
        <label>
          Contact email
          <input name="address" type="email" required />
        </label>
        <button disabled={save.isPending}>Save contact</button>
      </form>
      {q.data?.contacts.map((c) => (
        <p key={c.address}>
          {c.name} {c.address}{" "}
          <button
            type="button"
            aria-label={"Remove contact " + c.address}
            onClick={() => save.mutate({ action: "contact_remove", address: c.address })}
          >
            Remove
          </button>
        </p>
      ))}
      {(q.error || save.error) && <p role="alert">{(q.error || save.error)?.message}</p>}
      {save.isSuccess && <p role="status">Saved.</p>}
    </details>
  );
}
