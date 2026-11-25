import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { refreshMail } from "./triage-notice";
export function MarkOnOpen({ box, id, unread }: { box: string; id: string; unread: boolean }) {
  const [mark] = useState(() => unread && localStorage.getItem("edge-mail-mark-on-open") === "on");
  const [error, setError] = useState("");
  const client = useQueryClient();
  useEffect(() => {
    if (mark)
      void api("mailboxes/" + box + "/messages/" + id, { field: "is_read", value: true })
        .then(() => refreshMail(client))
        .catch((e) => setError(e instanceof Error ? e.message : "Could not mark read"));
  }, [box, id, mark, client]);
  return error ? <small role="alert">{error}</small> : null;
}
