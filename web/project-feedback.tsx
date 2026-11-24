import { useState } from "react";
import * as z from "zod/mini";
import { version } from "../package.json";
import { areas, kinds, replyFormat, reportFormat } from "../src/feedback-format";
import { api } from "./api";

const labels = {
  bug: "Something broke",
  confusing: "Hard to use",
  missing: "Missing feature",
  slow: "Slow performance",
  idea: "Suggestion",
  question: "Question",
};
const entryFormat = z.object({
  id: z.uuid(),
  report: reportFormat,
  sent: z.boolean(),
  result: z.optional(replyFormat),
});
type Entry = z.infer<typeof entryFormat>;
type Report = Entry["report"];

function readHistory(prefix: string): Entry[] {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(prefix))
      .sort()
      .reverse()
      .flatMap((k) => {
        const item = entryFormat.safeParse(JSON.parse(localStorage.getItem(k) || "null"));
        return item.success ? [item.data] : [];
      });
  } catch {
    return [];
  }
}

function Review({ report }: { report: Report }) {
  return (
    <section aria-label="Feedback preview">
      <h2>Review your feedback</h2>
      <p>The Edge Mail maintainer will receive these details privately.</p>
      <dl className="feedback-preview">
        <dt>Category</dt>
        <dd>{labels[report.kind]}</dd>
        <dt>Area</dt>
        <dd>{report.tool_name || "Unspecified"}</dd>
        <dt>Version</dt>
        <dd>{report.server_version}</dd>
        <dt>Summary</dt>
        <dd>{report.summary}</dd>
      </dl>
    </section>
  );
}

function FeedbackForm({ onSend, busy }: { onSend: (report: Report) => void; busy: boolean }) {
  const [summary, setSummary] = useState("");
  const [kind, setKind] = useState<Report["kind"]>("bug");
  const [area, setArea] = useState<Report["tool_name"]>("");
  const [preview, setPreview] = useState(false);
  const report = { kind, tool_name: area, summary: summary.trim(), server_version: version };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (preview) {
          onSend(report);
          setPreview(false);
          setSummary("");
        } else setPreview(true);
      }}
    >
      {preview ? (
        <Review report={report} />
      ) : (
        <>
          <h2>Send private feedback</h2>
          <div className="feedback-fields">
            <label>
              Category
              <select value={kind} onChange={(e) => setKind(kinds[e.target.selectedIndex])}>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {labels[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Area (optional)
              <select value={area} onChange={(e) => setArea(areas[e.target.selectedIndex])}>
                {areas.map((a) => (
                  <option value={a} key={a}>
                    {a || "Choose an area"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Summary
            <textarea
              required
              maxLength={200}
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              aria-describedby="feedback-hint"
            />
          </label>
          <small id="feedback-hint">
            Leave out email addresses, message contents and secrets. {summary.length}/200
          </small>
        </>
      )}
      <div className="feedback-actions">
        {preview && (
          <button type="button" onClick={() => setPreview(false)}>
            Edit feedback
          </button>
        )}
        <button className="primary" disabled={busy || !report.summary}>
          {preview ? "Send privately" : "Review feedback"}
        </button>
      </div>
    </form>
  );
}

export function ProjectFeedback({ email }: { email: string }) {
  const prefix = "edge-mail-feedback/" + encodeURIComponent(email) + "/";
  const [entries, setEntries] = useState(() => readHistory(prefix));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [volatile, setVolatile] = useState(false);
  function save(item: Entry) {
    try {
      localStorage.setItem(prefix + item.id, JSON.stringify(item));
    } catch {
      setVolatile(true);
    }
    setEntries((list) => [item, ...list.filter((v) => v.id !== item.id)]);
  }
  async function contact(item: Entry) {
    setBusy(true);
    setNotice("");
    try {
      if (item.sent) {
        const value = await api("project-feedback", { action: "status", id: item.id });
        save({ ...item, result: replyFormat.parse(value) });
        setNotice("Status updated.");
      } else {
        await api("project-feedback", { action: "send", id: item.id, report: item.report });
        save({ ...item, sent: true });
        setNotice("Feedback sent. You can check here for a reply.");
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not reach the feedback inbox.");
    } finally {
      setBusy(false);
    }
  }
  function forget(id: string) {
    try {
      localStorage.removeItem(prefix + id);
    } catch {
      setVolatile(true);
    }
    setEntries((list) => list.filter((item) => item.id !== id));
  }
  return (
    <div className="project-feedback">
      <FeedbackForm
        busy={busy}
        onSend={(report) => {
          const item = { id: crypto.randomUUID(), report, sent: false };
          save(item);
          void contact(item);
        }}
      />
      <p role="status">{notice}</p>
      {volatile && (
        <p role="alert">
          Browser storage is unavailable. Keep this page open to check for a reply.
        </p>
      )}
      <section aria-label="Your reports">
        <h2>Your reports</h2>
        <p>
          Receipts are saved in this browser. Removing one also removes your way to check for a
          reply.
        </p>
        {!entries.length && <p>No reports on this device yet.</p>}
        {entries.map((item) => (
          <article key={item.id}>
            <strong>{item.report.summary}</strong>
            <small>
              {labels[item.report.kind]} ·{" "}
              {item.result?.status ?? (item.sent ? "Received" : "Send unconfirmed")}
            </small>
            {item.result?.reply && <blockquote>{item.result.reply}</blockquote>}
            {item.result?.issue && (
              <a href={item.result.issue} target="_blank" rel="noreferrer">
                View linked GitHub issue
              </a>
            )}
            <div className="feedback-actions">
              <button disabled={busy} onClick={() => void contact(item)}>
                {item.sent ? "Check for reply" : "Retry send"}
              </button>
              <button className="quiet" disabled={busy} onClick={() => forget(item.id)}>
                Remove receipt
              </button>
            </div>
          </article>
        ))}
      </section>
      <a
        href={
          "https://github.com/tannerwj/edge-mail/issues/new?template=feedback.yml&version=" +
          version
        }
        target="_blank"
        rel="noreferrer"
      >
        Open a public GitHub issue
      </a>
    </div>
  );
}
