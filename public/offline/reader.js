import { saved, forget, lock, validate } from "./device.js";
const status = document.getElementById("status"),
  list = document.getElementById("threads");
const erase = document.getElementById("forget");
let until = 0;
let timer,
  generation = 0;
function hide() {
  generation++;
  until = 0;
  erase.hidden = true;
  clearTimeout(timer);
  list.replaceChildren();
  status.textContent = "Checking this device…";
}
async function verifyConnection() {
  try {
    const response = await fetch("/api/offline/session", {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
      await validate(await response.json());
      location.replace("/app");
      return true;
    }
    if (response.type === "opaqueredirect" || [401, 403].includes(response.status)) {
      await forget();
      location.replace("/app");
      return true;
    }
    await lock();
    status.textContent = "Cannot verify mailbox access. Reconnect and reload to sign in.";
    return true;
  } catch {
    return false;
  }
}
async function reconnect() {
  hide();
  if (!(await verifyConnection())) status.textContent = "Reconnect to verify mailbox access.";
}
const element = (tag, value) => {
  const e = document.createElement(tag);
  e.textContent = value;
  return e;
};
async function display() {
  hide();
  // A cold browser can report online while its navigation already failed at the network.
  if (navigator.onLine && (await verifyConnection())) return;
  if (document.hidden) return;
  const generationAtStart = generation,
    archive = await saved();
  if (generationAtStart !== generation) return;
  if (!archive || !Number.isFinite(archive.expires) || archive.expires <= Date.now()) {
    status.textContent = "Reconnect and sign in to read mail on this device.";
    if (archive) await forget();
    return;
  }
  if (archive.locked) {
    status.textContent = "Reconnect to verify mailbox access.";
    return;
  }
  until = archive.expires;
  erase.hidden = false;
  status.textContent = archive.threads.length + " saved conversations · Read only";
  for (const m of archive.threads) {
    const d = document.createElement("details");
    d.append(
      element("summary", m.subject || "(No subject)"),
      element(
        "small",
        m.mailbox + " · " + m.sender + " · " + new Date(m.received_at).toLocaleString(),
      ),
      element("pre", m.text),
    );
    if (m.truncated) d.append(element("small", "Connect to read the rest."));
    list.append(d);
  }
  timer = setTimeout(
    () => void display(),
    Math.min(2147483647, Math.max(0, archive.expires - Date.now())),
  );
}
new BroadcastChannel("edge-mail-device").addEventListener("message", () => void display());
addEventListener("online", () => void reconnect());
addEventListener("pagehide", hide);
addEventListener("pageshow", () => void display());
document.addEventListener("visibilitychange", () => void display());
void display();

erase.addEventListener("click", () => {
  hide();
  void forget().then(display);
});
for (const type of ["pointerdown", "keydown"])
  document.addEventListener(
    type,
    (event) => {
      if (until && Date.now() >= until) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void display();
      }
    },
    true,
  );
