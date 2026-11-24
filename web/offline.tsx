import React, { useEffect, useState } from "react";
type Saved = { expires: number; locked?: boolean; threads: unknown[]; savedAt: number };
type Device = {
  validate(): Promise<unknown>;
  saved(): Promise<Saved | undefined>;
  sync(): Promise<number>;
  forget(): Promise<void>;
};
const deviceUrl = "/offline/device.js";
const device = (): Promise<Device> => import(/* @vite-ignore */ deviceUrl);
const disconnect = () => {
  document.getElementById("root")?.replaceChildren();
  location.replace("/offline/reader");
};
export async function recheckDevice() {
  const d = await device();
  try {
    const session = await d.validate();
    if (!session || !navigator.locks) return;
    await navigator.locks.request(
      "edge-mail-offline-refresh",
      { ifAvailable: true },
      async (lock) => {
        if (!lock) return;
        const archive = await d.saved();
        if (archive && Date.now() - archive.savedAt > 1800000) await d.sync();
      },
    );
  } catch {
    await d.forget();
  }
}
export function guardOffline() {
  addEventListener("offline", disconnect);
  if (!navigator.onLine) {
    disconnect();
    return;
  }
  void recheckDevice().catch(() => {});
  setInterval(() => {
    if (navigator.onLine && !document.hidden) void recheckDevice().catch(() => {});
  }, 1800000);
  addEventListener("pageshow", (e) => {
    if (e.persisted) void recheckDevice();
  });
}
export async function signOut() {
  try {
    await (await device()).forget();
  } finally {
    location.assign("/cdn-cgi/access/logout");
  }
}
export function OfflineSettings() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [available, setAvailable] = useState(false);
  useEffect(() => {
    void device()
      .then((d) => d.saved())
      .then((a) => setAvailable(!!a && a.expires > Date.now()))
      .catch(() => {});
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      if (!("serviceWorker" in navigator))
        throw Error("Offline reading requires a secure browser with service workers.");
      const registration = await navigator.serviceWorker.register("/offline-worker.js", {
        type: "module",
      });
      const sw = registration.installing;
      if (sw)
        await new Promise<void>((resolve, reject) => {
          const change = () => {
            if (sw.state === "activated") resolve();
            if (sw.state === "redundant") reject(Error("Offline installation failed"));
          };
          sw.addEventListener("statechange", change);
          change();
        });
      await navigator.serviceWorker.ready;
      const n = await (await device()).sync();
      setAvailable(true);
      setMessage(n + " conversations saved");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save mail");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    await (await device()).forget();
    setAvailable(false);
    setMessage("Saved mail removed");
  };
  return (
    <section>
      <h2>Offline reading</h2>
      <p>
        Save text from up to 200 recent conversations on this device until your sign-in expires.
      </p>
      <button disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : available ? "Update saved mail" : "Save mail on this device"}
      </button>{" "}
      {available && (
        <button className="quiet" disabled={busy} onClick={() => void remove()}>
          Remove saved mail
        </button>
      )}
      <output aria-live="polite">{message}</output>
    </section>
  );
}
