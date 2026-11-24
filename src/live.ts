import * as z from "zod/mini";
import { DurableObject } from "cloudflare:workers";
import { type Bindings, Problem } from "./env";
import { mailboxAccess, type User } from "./ops/access";

const session = z.object({ user: z.string(), box: z.string(), expires: z.number() });
const access = (env: Bindings, user: string, box: string) =>
  env.DB.prepare("SELECT b.id " + mailboxAccess + " AND b.id=?")
    .bind(user, box)
    .first<string>("id");
export async function connectLive(
  request: Request,
  env: Bindings,
  user: User,
  box: string,
  expires: number,
) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
    throw new Problem(426, "WebSocket upgrade required");
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    throw new Problem(403, "Same-origin connection required");
  if (!Number.isFinite(expires) || expires <= Date.now()) throw new Problem(401, "Session expired");
  if (!(await access(env, user.id, box))) throw new Problem(404, "Mailbox unavailable");
  const socket = env.LIVE.getByName(box);
  return socket.fetch(
    new Request("https://internal/live", {
      headers: {
        Upgrade: "websocket",
        "X-Actor": user.id,
        "X-Mailbox": box,
        "X-Expires": String(expires),
      },
    }),
  );
}
export async function changed(env: Bindings, box: string) {
  if (!env.LIVE) return;
  try {
    await env.LIVE.getByName(box).changed();
  } catch {
    console.error(JSON.stringify({ event: "live_notification_failed" }));
  }
}
export class MailboxLive extends DurableObject<Bindings> {
  private marker: string = crypto.randomUUID();
  private sleepers = new Set<() => void>();
  revision() {
    return this.marker;
  }
  async waitAfter(marker: string, ms: number) {
    if (marker !== this.marker || ms <= 0) return;
    if (this.sleepers.size >= 64) throw new Problem(429, "Too many mailbox waiters");
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.sleepers.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, Math.min(ms, 25000));
      this.sleepers.add(finish);
    });
  }
  async fetch(request: Request) {
    const user = request.headers.get("X-Actor"),
      box = request.headers.get("X-Mailbox"),
      expires = Number(request.headers.get("X-Expires"));
    if (!user || !box || !Number.isFinite(expires) || expires <= Date.now())
      return new Response(null, { status: 403 });
    if (!(await access(this.env, user, box))) return new Response(null, { status: 403 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [user]);
    pair[1].serializeAttachment({ user, box, expires });
    const alarm = await this.ctx.storage.getAlarm();
    if (!alarm || alarm > expires) await this.ctx.storage.setAlarm(expires);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async revoke(user: string) {
    for (const socket of this.ctx.getWebSockets(user)) socket.close(1008, "Access changed");
  }
  async changed() {
    this.marker = crypto.randomUUID();
    for (const finish of this.sleepers) finish();
    const allowed = new Map<string, boolean>();
    for (const socket of this.ctx.getWebSockets()) {
      const s = session.parse(socket.deserializeAttachment());
      if (s.expires <= Date.now()) {
        socket.close(1008, "Session expired");
        continue;
      }
      if (!allowed.has(s.user)) allowed.set(s.user, Boolean(await access(this.env, s.user, s.box)));
      if (!allowed.get(s.user)) socket.close(1008, "Access changed");
      else if (socket.readyState === WebSocket.OPEN) socket.send("changed");
    }
  }
  async alarm() {
    let next = Infinity;
    for (const socket of this.ctx.getWebSockets()) {
      const { expires } = session.parse(socket.deserializeAttachment());
      if (expires <= Date.now()) socket.close(1008, "Session expired");
      else next = Math.min(next, expires);
    }
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }
  webSocketMessage(socket: WebSocket) {
    socket.close(1003, "Read-only connection");
  }
  webSocketClose(socket: WebSocket) {
    socket.close(1000);
  }
}
