import { recheckDevice } from "./offline";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useLive(box: string | undefined) {
  const client = useQueryClient();
  useEffect(() => {
    if (!box) return undefined;
    const url = new URL("/api/live/" + box, location.origin);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    let socket: WebSocket | undefined,
      timeout: number | undefined,
      delay = 1000,
      stopped = false;
    const refresh = () => {
      void client.invalidateQueries({ queryKey: ["unified-inbox"] });
      for (const key of ["inbox", "message", "outbox"])
        void client.invalidateQueries({ queryKey: [key, box] });
    };
    function connect() {
      if (stopped || !navigator.onLine || document.hidden || socket) return;
      socket = new WebSocket(url);
      socket.addEventListener("open", () => {
        delay = 1000;
        refresh();
      });
      socket.addEventListener("message", (event) => {
        if (event.data === "changed") refresh();
      });
      socket.addEventListener("close", (event) => {
        socket = undefined;
        if (stopped) return;
        if (event.code === 1008) {
          client.removeQueries({ queryKey: ["unified-inbox"] });
          for (const key of ["inbox", "message", "outbox", "drafts"])
            client.removeQueries({ queryKey: [key, box] });
          void client.invalidateQueries({ queryKey: ["workspace"] });
          void recheckDevice().catch(() => {});
          return;
        }
        timeout = window.setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
      });
    }
    function visible() {
      if (!document.hidden) connect();
    }
    connect();
    addEventListener("online", connect);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearTimeout(timeout);
      removeEventListener("online", connect);
      document.removeEventListener("visibilitychange", visible);
      socket?.close();
    };
  }, [client, box]);
}
