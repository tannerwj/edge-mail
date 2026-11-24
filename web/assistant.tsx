import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import * as z from "zod/mini";
import { api, type Box } from "./api";
import { destination } from "./navigation";
const config = z.object({ available: z.boolean(), enabled: z.boolean() });
const suggestion = z.object({
  text: z.string(),
  rule: z.optional(
    z.object({
      field: z.enum(["from", "subject", "sender_domain"]),
      value: z.string(),
      label: z.string(),
    }),
  ),
});
const messageTasks = [
  ["summary", "Summarize thread"],
  ["draft", "Suggest reply"],
  ["category", "Suggest category"],
  ["spam", "Assess spam"],
];
const queryTasks = [
  ["search", "Suggest search"],
  ["rule", "Suggest label rule"],
];
const categories = ["Personal", "Receipts", "Updates", "Lists"];
export function MailAssistant({ box, id }: { box: Box; id?: string }) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient(),
    path = "mailboxes/" + box.id + "/assistant";
  const settings = useQuery({
    queryKey: ["mail-assistant", box.id],
    queryFn: async () => config.parse(await api(path)),
    enabled: open,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api(path, { action: "configure", enabled }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["mail-assistant", box.id] }),
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)} className="assistant">
      <summary>{id ? "Thread assistance" : "Mailbox assistance"}</summary>
      {!settings.data ? (
        <p role="status">{settings.error?.message || "Checking availability…"}</p>
      ) : !settings.data.available ? (
        <p>
          The instance owner can enable Workers AI with the installer’s <code>--ai</code> option.
        </p>
      ) : (
        <>
          <p>
            {settings.data.enabled
              ? "Each request shares the text you choose with Cloudflare Workers AI. Check the suggestion before using it."
              : "Workers AI is off for this mailbox."}
          </p>
          {!!box.can_forward && (
            <button
              disabled={toggle.isPending}
              onClick={() => {
                toggle.mutate(!settings.data?.enabled);
              }}
            >
              {settings.data.enabled ? "Turn off mailbox assistance" : "Allow mailbox assistance"}
            </button>
          )}
          {settings.data.enabled && <AssistanceTasks box={box} id={id} />}
        </>
      )}
      {toggle.error && <p role="alert">{toggle.error.message}</p>}
    </details>
  );
}
function AssistanceTasks({ box, id }: { box: Box; id?: string }) {
  const [prompt, setPrompt] = useState("");
  const path = "mailboxes/" + box.id + "/assistant";
  const generate = useMutation({
    mutationFn: async (action: string) => ({
      action,
      ...suggestion.parse(await api(path, { action, prompt, message: id })),
    }),
  });
  const result = generate.data;
  return (
    <>
      {" "}
      <>
        {!id && (
          <>
            <label>
              Describe a search or label rule
              <input
                maxLength={500}
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  generate.reset();
                }}
              />
            </label>
            <nav aria-label="Category searches">
              {categories.map((c) => (
                <Link key={c} {...destination({ box: box.id, q: "label:" + c })}>
                  {c}{" "}
                </Link>
              ))}
            </nav>
          </>
        )}
        <div>
          {(id ? messageTasks : queryTasks).map(([action, title]) => (
            <button
              key={action}
              disabled={generate.isPending || (!id && !prompt.trim())}
              onClick={() => {
                generate.mutate(action);
              }}
            >
              {title}
            </button>
          ))}
        </div>
        {generate.isPending && <p role="status">Generating suggestion…</p>}
        {result && (
          <Suggestion key={result.action + result.text} result={result} box={box} id={id} />
        )}
      </>
      {generate.error && <p role="alert">{generate.error.message}</p>}
    </>
  );
}
function Suggestion({
  result,
  box,
  id,
}: {
  result: z.infer<typeof suggestion> & { action: string };
  box: Box;
  id?: string;
}) {
  const [status, setStatus] = useState("");
  const client = useQueryClient();
  async function apply() {
    try {
      if (result?.action === "category" && id && categories.includes(result.text)) {
        await api("mailboxes/" + box.id + "/messages/" + id, {
          field: "label",
          value: result.text,
        });
        await client.invalidateQueries({ queryKey: ["message", box.id, id] });
        setStatus("Category saved.");
      } else if (result?.rule) {
        const rule = result.rule;
        await api("mailboxes/" + box.id + "/rules", {
          scope: "mailbox",
          revision: 0,
          document: {
            name: "Label " + rule.label,
            order: 100,
            enabled: true,
            stop: false,
            condition: {
              field: rule.field,
              op: rule.field === "subject" ? "contains" : "equals",
              value: rule.value,
            },
            actions: [{ kind: "label", value: rule.label }],
          },
        });
        setStatus("Mailbox label rule saved.");
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not save");
    }
  }
  return (
    <>
      {" "}
      <>
        <p className="body">
          {result.rule
            ? "If " +
              result.rule.field +
              " matches " +
              result.rule.value +
              ", add label " +
              result.rule.label
            : result.text}
        </p>
        {result.action === "search" && (
          <Link {...destination({ box: box.id, q: result.text })}>Run suggested search</Link>
        )}
        {result.action === "draft" && (
          <button
            onClick={() =>
              void navigator.clipboard.writeText(result.text).then(
                () => setStatus("Draft copied."),
                () => setStatus("Select and copy the suggested draft."),
              )
            }
          >
            Copy draft
          </button>
        )}
        {!!box.can_edit && (result.rule || result.action === "category") && (
          <button disabled={!!status} onClick={() => void apply()}>
            {result.rule ? "Create this label rule" : "Apply suggested category"}
          </button>
        )}
      </>
      <output>{status}</output>
    </>
  );
}
