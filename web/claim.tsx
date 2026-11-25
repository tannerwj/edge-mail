import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Box } from "./api";
import { refreshMail } from "./triage-notice";

export function Claim({
  box,
  state,
}: {
  box: Box;
  state: { thread_id: string; mine: number; claimed_by: string | null };
}) {
  const client = useQueryClient();
  const change = useMutation({
    mutationFn: () =>
      api("mailboxes/" + box.id + "/claims/" + state.thread_id, {
        action: state.mine ? "release" : "claim",
      }),
    onSettled: () => refreshMail(client),
  });
  return (
    <div className="conversation-claim">
      <span>{state.claimed_by ? "Claimed by " + state.claimed_by : "Unclaimed conversation"}</span>
      {!!box.can_edit && (!state.claimed_by || !!state.mine) && (
        <button disabled={change.isPending} onClick={() => change.mutate()}>
          {state.mine ? "Release claim" : "Claim conversation"}
        </button>
      )}
      {change.error && <small role="alert">{change.error.message}</small>}
    </div>
  );
}
