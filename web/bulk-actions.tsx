import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export function useSelection() {
  const [ids, setIds] = useState<string[]>([]);
  const [active, setActive] = useState(false);
  function close() {
    setIds([]);
    setActive(false);
  }
  function toggle(id: string) {
    setIds((old) =>
      old.includes(id)
        ? old.filter((value) => value !== id)
        : old.length < 200
          ? [...old, id]
          : old,
    );
  }
  return { ids, setIds, active, open: () => setActive(true), close, toggle };
}

export function BulkActions({
  box,
  selection,
  loaded,
}: {
  box: string;
  selection: ReturnType<typeof useSelection>;
  loaded: string[];
}) {
  const client = useQueryClient();
  const [label, setLabel] = useState("");
  const save = useMutation({
    mutationFn: (data: { field: string; value: string | boolean }) =>
      api("mailboxes/" + box + "/triage", { ...data, ids: selection.ids }),
    onSuccess: async () => {
      selection.close();
      await Promise.all([
        client.invalidateQueries({ queryKey: ["workspace"] }),
        client.invalidateQueries({ queryKey: ["unified-inbox"] }),
        client.invalidateQueries({ queryKey: ["inbox", box] }),
        client.invalidateQueries({ queryKey: ["message", box] }),
      ]);
    },
  });
  if (!selection.active)
    return (
      <button className="quiet" onClick={selection.open}>
        Select messages
      </button>
    );
  return (
    <fieldset className="bulk-actions" disabled={save.isPending}>
      <legend>{selection.ids.length} messages selected</legend>
      <button
        type="button"
        className="quiet"
        onClick={() => selection.setIds([...new Set([...selection.ids, ...loaded])].slice(0, 200))}
      >
        Select loaded messages
      </button>
      <button type="button" className="quiet" onClick={selection.close}>
        Cancel selection
      </button>
      {selection.ids.length > 0 && (
        <>
          <button onClick={() => save.mutate({ field: "folder", value: "archive" })}>
            Archive selected
          </button>
          <button onClick={() => save.mutate({ field: "is_read", value: true })}>
            Mark selected read
          </button>
          <label>
            Label for selected messages
            <input
              value={label}
              maxLength={80}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <button
            disabled={!label.trim()}
            onClick={() => save.mutate({ field: "label", value: label.trim() })}
          >
            Apply label
          </button>
        </>
      )}
      {selection.ids.length === 200 && <p role="status">Selection limit reached (200 messages).</p>}
      {save.error && <p role="alert">{save.error.message}</p>}
    </fieldset>
  );
}
