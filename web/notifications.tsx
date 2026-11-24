import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
const statusSchema = z.object({
  publicKey: z.string(),
  devices: z.array(z.object({ id: z.string(), new_mail: z.number() })),
});
async function currentDevice() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager?.getSubscription();
  if (!sub) return null;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint));
  return {
    id: Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join(""),
    sub,
  };
}
export function NotificationSettings() {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const supported =
    "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  const q = useQuery({
    queryKey: ["push"],
    enabled: open && supported,
    queryFn: async () => {
      const settings = statusSchema.parse(await api("notifications")),
        current = await currentDevice();
      return { ...settings, current, device: settings.devices.find((d) => d.id === current?.id) };
    },
  });
  async function save(mode: string) {
    if (!q.data || !["off", "mail", "security"].includes(mode)) return;
    setBusy(true);
    setStatus("");
    try {
      if (mode === "off" && q.data.current) {
        await api("notifications", { action: "remove", id: q.data.current.id });
        await q.data.current.sub.unsubscribe();
      } else {
        if ((await Notification.requestPermission()) !== "granted")
          throw Error("Allow notifications in this browser’s site settings.");
        await navigator.serviceWorker.register("/offline-worker.js", {
          type: "module",
          scope: "/",
        });
        const reg = await navigator.serviceWorker.ready;
        const key = Uint8Array.from(
          atob(q.data.publicKey.replaceAll("-", "+").replaceAll("_", "/")),
          (v) => v.charCodeAt(0),
        );
        const sub =
          q.data.current?.sub ||
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
        await api("notifications", {
          action: "subscribe",
          subscription: sub.toJSON(),
          new_mail: mode === "mail",
        });
      }
      await q.refetch();
      setStatus("Device preferences saved.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not update this device");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Device notifications</summary>
      {!supported ? (
        <p>
          This browser does not support Web Push. On iPhone, open Edge Mail from the Home Screen.
        </p>
      ) : (
        <>
          <p>
            Choose which notifications appear on this device. Message subjects and senders stay
            private.
          </p>
          <label>
            Notify this device
            <select
              value={q.data?.device ? (q.data.device.new_mail ? "mail" : "security") : "off"}
              disabled={!q.data || busy}
              onChange={(e) => void save(e.target.value)}
            >
              <option value="off">Off</option>
              <option value="security">Mail forwarding and security changes</option>
              <option value="mail">New mail and security changes</option>
            </select>
          </label>
          {q.error && <p role="alert">{q.error.message}</p>}
        </>
      )}
      <p role="status">{status}</p>
    </details>
  );
}
const notice = z.object({
  audit_id: z.string(),
  mailbox_id: z.string(),
  address: z.string(),
  name: z.string(),
});
export function ChangeNotices() {
  const client = useQueryClient(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["egress-notices"],
    refetchInterval: 30000,
    queryFn: async () => z.array(notice).parse(await api("notices")),
  });
  async function act(n: z.infer<typeof notice>, undo: boolean) {
    setBusy(true);
    setError("");
    try {
      if (undo) await api("mailboxes/" + n.mailbox_id + "/activity/" + n.audit_id, {});
      await api("notices/" + n.audit_id + "/ack", {});
      await client.invalidateQueries({ queryKey: ["egress-notices"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update this change");
    } finally {
      setBusy(false);
    }
  }
  if (!q.data?.length) return null;
  return (
    <section aria-label="Mail forwarding and security changes">
      {q.data.map((n) => (
        <div role="status" key={n.audit_id}>
          <strong>Mail egress changed</strong>
          <p>
            {n.name} changed an automatic delivery rule for {n.address}.
          </p>
          <button disabled={busy} onClick={() => void act(n, true)}>
            Undo change
          </button>{" "}
          <button disabled={busy} onClick={() => void act(n, false)}>
            Acknowledge
          </button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
