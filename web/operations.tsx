import React from "react";
import { useQuery } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";

const status = z.object({
  schemaReady: z.boolean(),
  missing: z.array(z.string()),
  databaseBytes: z.number(),
  dailyLimit: z.number(),
  activity: z.nullable(
    z.object({
      ingestFailures: z.number(),
      complaints: z.number(),
      uncertain: z.number(),
      deferred: z.number(),
      nextDue: z.nullable(z.number()),
      paused: z.number(),
      reserved: z.number(),
      lastBackup: z.nullable(z.string()),
      backupPhase: z.nullable(z.string()),
    }),
  ),
});
function Report() {
  const result = useQuery({
    queryKey: ["instance-operations"],
    queryFn: async () => status.parse(await api("operations")),
    refetchInterval: 60000,
  });
  if (!result.data) return <p role="status">{result.error?.message || "Checking instance…"}</p>;
  const { activity, missing, schemaReady, databaseBytes, dailyLimit } = result.data;
  return (
    <>
      {!schemaReady && (
        <p role="alert">Database migrations are incomplete. Check the release migration plan.</p>
      )}
      {missing.length > 0 && <p role="alert">Missing bindings · {missing.join(", ")}</p>}
      <dl className="ops">
        <dt>D1 storage</dt>
        <dd>
          {(databaseBytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 2 })} MiB
        </dd>
        {activity && (
          <>
            <dt>Daily recipient reservations (UTC)</dt>
            <dd>
              {activity.reserved} / {dailyLimit}
            </dd>
            <dt>Receipt failures</dt>
            <dd>{activity.ingestFailures}</dd>
            <dt>Uncertain sends</dt>
            <dd>{activity.uncertain}</dd>
            <dt>Deferred sends</dt>
            <dd>{activity.deferred}</dd>
            <dt>Dispatch hold</dt>
            <dd>{activity.paused ? "Active" : "Clear"}</dd>
            {activity.nextDue !== null && (
              <>
                <dt>Next submission due</dt>
                <dd>{new Date(activity.nextDue).toLocaleString()}</dd>
              </>
            )}
            <dt>Recipient complaints</dt>
            <dd role={activity.complaints ? "alert" : undefined}>{activity.complaints}</dd>
            <dt>Latest completed backup</dt>
            <dd>
              {activity.lastBackup
                ? new Date(activity.lastBackup).toLocaleString()
                : "Awaiting first snapshot"}
            </dd>
            {activity.backupPhase && (
              <>
                <dt>Backup in progress</dt>
                <dd>{activity.backupPhase}</dd>
              </>
            )}
          </>
        )}
      </dl>
      <button className="quiet" disabled={result.isFetching} onClick={() => void result.refetch()}>
        Refresh status
      </button>
    </>
  );
}
export function Operations() {
  const [open, setOpen] = React.useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Instance operations</summary>
      {open && <Report />}
    </details>
  );
}
