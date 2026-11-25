import { Clock3 } from "lucide-react";
import { TimePresets } from "./time-presets";
import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Box } from "./api";
type State = {
  thread_id: string;
  muted: number | null;
  snoozed_until: number | null;
  follow_up_at: number | null;
  if_no_reply: number | null;
  follow_ready: number | null;
};
export function Reminders({ box, state }: { box: Box; state: State }) {
  const client = useQueryClient(),
    [time, setTime] = useState(""),
    [kind, setKind] = useState("thread_snooze");
  const save = useMutation({
    mutationFn: (data: object) =>
      api("mailboxes/" + box.id + "/reminders", { ids: [state.thread_id], ...data }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["message", box.id] }),
        client.invalidateQueries({ queryKey: ["inbox", box.id] }),
        client.invalidateQueries({ queryKey: ["unified-inbox"] }),
      ]);
    },
  });
  return (
    <details className="reader-reminders">
      <summary>
        <Clock3 size={16} /> {box.can_edit ? "Snooze or follow up" : "Conversation reminders"}
      </summary>
      <p>{state.muted ? "Future replies go to Archive." : "Future replies appear in the inbox."}</p>
      {state.snoozed_until && (
        <p>
          Snoozed until <time>{new Date(state.snoozed_until).toLocaleString()}</time>
        </p>
      )}
      {state.follow_up_at && (
        <p>
          {state.follow_ready ? "Follow-up due" : "Follow up"}{" "}
          <time>{new Date(state.follow_up_at).toLocaleString()}</time>
          {state.if_no_reply ? " if nobody replies." : "."}
        </p>
      )}
      {!!box.can_edit && (
        <fieldset disabled={save.isPending}>
          <legend>Manage conversation</legend>
          <button onClick={() => save.mutate({ action: "thread_mute", muted: !state.muted })}>
            {state.muted ? "Unmute replies" : "Mute replies"}
          </button>
          {!!state.snoozed_until && (
            <button onClick={() => save.mutate({ action: "thread_snooze", at: null })}>
              End snooze
            </button>
          )}
          {!!state.follow_up_at && (
            <button onClick={() => save.mutate({ action: "thread_follow_up", at: null })}>
              Clear follow-up
            </button>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const chosen = f.get("time");
              if (typeof chosen !== "string") return;
              save.mutate({
                action: kind,
                at: new Date(chosen).valueOf(),
                if_no_reply: f.has("conditional"),
              });
            }}
          >
            <label>
              Reminder type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="thread_snooze">Snooze</option>
                <option value="thread_follow_up">Follow up</option>
              </select>
            </label>
            <TimePresets choose={setTime} />
            <label>
              Reminder time
              <input
                type="datetime-local"
                name="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
              />
            </label>
            {kind === "thread_follow_up" && (
              <label>
                <input type="checkbox" name="conditional" defaultChecked />
                Only if nobody replies
              </label>
            )}
            <button>Save reminder</button>
          </form>
        </fieldset>
      )}
      {save.error && <p role="alert">{save.error.message}</p>}
      {save.isSuccess && <p role="status">Conversation updated.</p>}
    </details>
  );
}
