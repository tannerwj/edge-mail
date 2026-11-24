// IndexedDB is per origin. One active archive prevents another signed-in account from inheriting it.
const database = "edge-mail-offline",
  store = "device";
const request = (op) =>
  new Promise((resolve, reject) => {
    op.addEventListener("success", () => resolve(op.result));
    op.addEventListener("error", () => reject(op.error));
  });
async function transact(mode, fn) {
  const opening = indexedDB.open(database, 1);
  opening.addEventListener("upgradeneeded", () => opening.result.createObjectStore(store));
  const db = await request(opening);
  try {
    const tx = db.transaction(store, mode);
    const done = new Promise((r, j) => {
      tx.addEventListener("complete", r);
      tx.addEventListener("abort", () => j(tx.error));
    });
    const result = await fn(tx.objectStore(store));
    await done;
    return result;
  } finally {
    db.close();
  }
}
const same = (a, b) => a && b && a.user === b.user && a.scope === b.scope;
const current = (a) => a && Number.isFinite(a.expires) && a.expires > Date.now();
export async function clear() {
  await transact("readwrite", (s) => request(s.clear()));
}
const notify = () => {
  const channel = new BroadcastChannel("edge-mail-device");
  // BroadcastChannel is scoped to this origin and has no targetOrigin argument.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  channel.postMessage("changed");
  channel.close();
};
export async function forget() {
  await clear();
  notify();
}
async function online(path) {
  const r = await fetch("/api/offline/" + path, { redirect: "manual", cache: "no-store" });
  if (!r.ok || !r.headers.get("content-type")?.includes("application/json")) {
    await forget();
    throw Error("Sign in again to save mail.");
  }
  return r.json();
}
export async function saved() {
  return transact("readonly", (s) => request(s.get("archive")));
}
export async function lock() {
  await transact("readwrite", async (s) => {
    const old = await request(s.get("archive"));
    if (old) s.put({ ...old, locked: true }, "archive");
    s.delete("job");
  });
}
export async function validate(verifiedSession) {
  const old = await saved();
  if (!old) return null;
  if (!current(old)) {
    await forget();
    return null;
  }
  const session = verifiedSession || (await online("session"));
  if (!same(old, session) || !current(session)) {
    await forget();
    return null;
  }
  await transact("readwrite", async (s) => {
    const live = await request(s.get("archive"));
    if (same(live, session)) s.put({ ...live, expires: session.expires, locked: false }, "archive");
  });
  return session;
}
export async function sync() {
  const session = await online("session");
  if (!current(session)) throw Error("Session expired");
  const job = crypto.randomUUID();
  await transact("readwrite", async (s) => {
    const old = await request(s.get("archive"));
    if (!same(old, session) || !current(old)) s.delete("archive");
    s.put(job, "job");
  });
  const threads = [];
  let before = "";
  do {
    const page = await online("threads?" + new URLSearchParams({ scope: session.scope, before }));
    if (!same(page, session) || !current(page)) {
      await forget();
      throw Error("Mailbox access changed");
    }
    threads.push(...page.threads);
    before = page.next;
  } while (before && threads.length < 200);
  const final = await online("session");
  if (!same(final, session) || !current(final)) {
    await forget();
    throw Error("Mailbox access changed");
  }
  await transact("readwrite", async (s) => {
    if ((await request(s.get("job"))) !== job) throw Error("Offline update superseded");
    s.put({ ...final, threads: threads.slice(0, 200), savedAt: Date.now() }, "archive");
    s.delete("job");
  });
  notify();
  return threads.length;
}
