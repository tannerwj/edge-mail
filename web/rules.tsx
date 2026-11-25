import { RuleRecipient } from "./rule-recipient";
import { useDestinations, DestinationSettings, type Destination } from "./destinations";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api, type Box } from "./api";

const entry = z.object({
  rule_id: z.string(),
  revision: z.number(),
  scope: z.string(),
  authorized: z.number(),
  document: z.object({ name: z.string(), enabled: z.boolean() }),
});
const preview = z.object({
  scanned: z.number(),
  matches: z.array(z.object({ subject: z.string() })),
});
function ForwardFields({ destinations }: { destinations: Destination[] }) {
  const [mode, setMode] = useState("relay");
  return (
    <>
      <label>
        Forward to
        <select name="destination">
          {destinations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.address}
            </option>
          ))}
        </select>
      </label>
      <label>
        Delivery mode
        <select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="relay">Relay original (header conditions)</option>
          <option value="resend">Send from mailbox with original attached</option>
        </select>
      </label>
      {mode === "resend" && (
        <label>
          <input type="checkbox" name="replyThrough" /> Allow one reply through the mailbox within
          seven days
        </label>
      )}
      <label>
        Also add label (optional)
        <input name="alsoLabel" maxLength={80} />
      </label>
      <p>
        Relay preserves the original sender. Sending from the mailbox uses its sending quota. Both
        require authenticated, non-automated mail.
      </p>
    </>
  );
}

function buildActions(action: string, data: FormData) {
  if (["agent_notify", "notify", "webhook"].includes(action))
    return [{ kind: action, target: data.get("target") }];
  if (action === "snooze") return [{ kind: "snooze", minutes: Number(data.get("minutes")) }];
  if (action === "auto_reply")
    return [{ kind: action, text: data.get("template"), days: Number(data.get("interval")) }];
  if (action === "forward")
    return [
      ...(data.get("alsoLabel") ? [{ kind: "label", value: data.get("alsoLabel") }] : []),
      {
        kind: "forward",
        mode: data.get("mode"),
        destination: data.get("destination"),
        ...(data.get("replyThrough") ? { reply_through: true } : {}),
      },
    ];
  return [action === "label" ? { kind: action, value: data.get("label") } : { kind: action }];
}
function MatchFields() {
  return (
    <>
      <label>
        Match on
        <select name="field">
          <option value="from">Sender address</option>
          <option value="sender_domain">Sender domain</option>
          <option value="subject">Subject</option>
          <option value="body">Message text</option>
          <option value="delivered_to">Delivered to</option>
        </select>
      </label>
      <label>
        Comparison
        <select name="op">
          <option value="equals">Equals</option>
          <option value="contains">Contains</option>
          <option value="starts_with">Starts with</option>
          <option value="ends_with">Ends with</option>
          <option value="glob">Wildcard</option>
          <option value="matches">Regular expression</option>
        </select>
      </label>
      <label>
        Match value
        <input name="value" maxLength={256} required />
      </label>
    </>
  );
}
function ruleDocument(data: FormData, action: string) {
  return {
    name: data.get("name"),
    order: 100,
    enabled: true,
    stop: data.has("stop"),
    condition: { field: data.get("field"), op: data.get("op"), value: data.get("value") },
    actions: buildActions(action, data),
  };
}
function RuleForm({
  canNotify,
  path,
  destinations,
  refresh,
}: {
  canNotify: boolean;
  path: string;
  destinations: Destination[];
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState(location.hash === "#vacation-reply" ? "auto_reply" : "label");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    const dry = !(
      event.nativeEvent instanceof SubmitEvent &&
      event.nativeEvent.submitter?.getAttribute("value") === "save"
    );
    const document = ruleDocument(data, action);
    setBusy(true);
    try {
      const result = await api(path, { document, scope: "mailbox", revision: 0, dry_run: dry });
      if (dry) {
        const p = preview.parse(result);
        setFeedback(
          `Matched ${p.matches.length} of ${p.scanned} recent messages. ${p.matches.map((m) => m.subject).join(" · ")}`,
        );
      } else {
        setFeedback("Rule saved.");
        form.reset();
        setAction("label");
        refresh();
      }
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Rule could not be saved");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <label>
        Rule name
        <input name="name" maxLength={80} required />
      </label>
      <MatchFields />
      <label>
        When matched
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="label">Add label</option>
          <option value="snooze">Snooze message</option>
          {canNotify && (
            <>
              <option value="notify">Notify a mailbox member</option>
              <option value="webhook">Send a signed webhook</option>
              <option value="agent_notify">Notify a connected agent</option>
            </>
          )}
          <option value="archive">Archive</option>
          <option value="auto_reply">Vacation reply</option>
          <option value="mark_read">Mark read</option>
          <option value="star">Star</option>
          <option value="spam">Move to Spam</option>
          <option value="trash">Move to Trash</option>
          {!!destinations.length && <option value="forward">Forward</option>}
        </select>
      </label>
      {canNotify && ["notify", "webhook", "agent_notify"].includes(action) && (
        <RuleRecipient path={path} action={action} />
      )}
      {action === "snooze" && (
        <label>
          Snooze for (minutes)
          <input type="number" min="1" max="525600" defaultValue="60" name="minutes" required />
        </label>
      )}
      {action === "auto_reply" && (
        <>
          <label>
            Vacation message
            <textarea name="template" maxLength={4000} required />
          </label>
          <label>
            Days between replies to the same sender
            <input type="number" min="1" max="30" name="interval" defaultValue="7" required />
          </label>
        </>
      )}
      {action === "forward" && <ForwardFields destinations={destinations} />}
      {action === "label" && (
        <label>
          Rule label
          <input name="label" maxLength={80} required />
        </label>
      )}
      <label>
        <input type="checkbox" name="stop" /> Stop after this rule
      </label>
      <div>
        <button disabled={busy} value="preview">
          Preview recent matches
        </button>{" "}
        <button disabled={busy} value="save">
          Save rule
        </button>
      </div>
      <output aria-live="polite">{feedback}</output>
    </form>
  );
}

function RuleVersions({
  path,
  revision,
  enabled,
  refresh,
}: {
  path: string;
  revision: number;
  enabled: boolean;
  refresh: () => void;
}) {
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const result = useQuery({
    queryKey: ["rule-versions", path, revision],
    queryFn: async () =>
      z
        .object({
          versions: z.array(z.object({ revision: z.number() })),
          runs: z.array(z.object({ message_id: z.string(), at: z.string() })),
          forwards: z.array(
            z.object({
              id: z.string(),
              mode: z.string(),
              state: z.string(),
              reason: z.nullable(z.string()),
              at: z.number(),
            }),
          ),
        })
        .parse(await api(path)),
  });
  async function update(data: object) {
    setBusy(true);
    try {
      await api(path, { revision, ...data });
      setStatus("Saved");
      refresh();
      await result.refetch();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }
  if (result.error) return <p role="alert">{result.error.message}</p>;
  return (
    <div>
      <button disabled={busy} onClick={() => void update({ enabled: !enabled })}>
        {enabled ? "Disable rule" : "Enable rule"}
      </button>
      <button disabled={busy || !enabled} onClick={() => void update({ action: "apply_existing" })}>
        Apply to recent matches
      </button>
      {result.data?.versions
        .filter((v) => v.revision < revision)
        .map((v) => (
          <button
            key={v.revision}
            disabled={busy}
            onClick={() => void update({ restore: v.revision })}
          >
            Restore version {v.revision}
          </button>
        ))}
      <p>{result.data?.runs.length ?? 0} recent matches recorded</p>
      {!!result.data?.forwards.length && (
        <ul>
          {result.data.forwards.map((a) => (
            <li key={a.id}>
              {new Date(a.at).toLocaleString()} · {a.mode} · {a.state}
              {a.reason ? " · " + a.reason : ""}
            </li>
          ))}
        </ul>
      )}
      <output>{status}</output>
    </div>
  );
}
export function Rules({ mailboxes }: { mailboxes: Box[] }) {
  const [box, setBox] = useState(mailboxes[0]?.id || ""),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState("");
  const path = "mailboxes/" + box + "/rules";
  const q = useQuery({
    queryKey: ["rules", box],
    enabled: open && !!box,
    queryFn: async () => z.array(entry).parse(await api(path)),
  });
  const refresh = () => void q.refetch();
  const canForward = Boolean(mailboxes.find((b) => b.id === box)?.can_forward);
  const destinations = useDestinations(box, open && canForward);
  if (!mailboxes.length) return null;
  return (
    <details id="vacation-reply" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Mail rules</summary>
      <label>
        Rules for mailbox
        <select
          value={box}
          onChange={(e) => {
            setBox(e.target.value);
            setSelected("");
          }}
        >
          {mailboxes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.address}
            </option>
          ))}
        </select>
      </label>
      {canForward && (
        <DestinationSettings
          box={box}
          entries={destinations.data || []}
          refresh={() => void destinations.refetch()}
        />
      )}
      {destinations.error && <p role="alert">{destinations.error.message}</p>}
      {q.error && <p role="alert">{q.error.message}</p>}
      <ul>
        {q.data?.map((r) => (
          <li key={r.rule_id}>
            {r.document.name} · {r.scope} · version {r.revision}
            {!r.document.enabled || !r.authorized ? " · inactive" : ""}
            {!!mailboxes.find((b) => b.id === box)?.can_edit && r.scope === "mailbox" && (
              <button onClick={() => setSelected(selected === r.rule_id ? "" : r.rule_id)}>
                Manage {r.document.name}
              </button>
            )}
            {selected === r.rule_id && (
              <RuleVersions
                path={path + "/" + r.rule_id}
                revision={r.revision}
                enabled={r.document.enabled}
                refresh={refresh}
              />
            )}
          </li>
        ))}
      </ul>
      {!!mailboxes.find((b) => b.id === box)?.can_edit && (
        <RuleForm
          canNotify={canForward}
          key={box}
          path={path}
          destinations={(destinations.data || []).filter((d) => !!d.verified_at && !d.disabled)}
          refresh={refresh}
        />
      )}
    </details>
  );
}
