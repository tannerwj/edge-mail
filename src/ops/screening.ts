import { classify, features } from "../spam-classifier";
import type { Bindings } from "../env";
import type { Facts } from "../rule-matcher";
type Db = Pick<Bindings, "DB">;
type Policy = {
  screen_unknown: number;
  quarantine_auth: number;
  learn: number;
  disposition: string | null;
};
async function senderPolicy(env: Db, box: string, sender: string): Promise<Policy> {
  const row =
    await env.DB.prepare(`SELECT coalesce(p.screen_unknown,0) screen_unknown,coalesce(p.quarantine_auth,1) quarantine_auth,coalesce(p.learn,0) learn,
    (SELECT disposition FROM sender_list WHERE scope_id IN ('*',?) AND pattern IN (?,?)
      ORDER BY (scope_id!='*') DESC, (instr(pattern,'@')>0) DESC LIMIT 1) disposition
    FROM (SELECT 1) LEFT JOIN mailbox_screening p ON p.mailbox_id=?`)
      .bind(box, sender, sender.split("@").at(-1) || "", box)
      .first<Policy>();
  if (!row) throw Error("Screening policy unavailable");
  return row;
}
function headerDecision(p: Policy, facts: Facts) {
  if (p.quarantine_auth && facts.dmarc?.includes("fail")) return "DMARC failed";
  if (p.disposition === "block") return "Sender is on the blocklist";
  if (p.disposition === "allow") return "Allowed sender";
  if (p.screen_unknown) return "Awaiting sender review";
  return null;
}
export async function relayScreen(env: Db, box: string, facts: Facts) {
  const p = await senderPolicy(env, box, facts.from[0]);
  const reason = headerDecision(p, facts);
  if (reason === "Allowed sender") return null;
  return reason || (p.learn ? "Content filtering requires queued resend" : null);
}
async function learned(env: Db, words: string[]) {
  const rows = (
    await env.DB.prepare(
      "SELECT token,spam,ham FROM spam_counts WHERE token IN(SELECT value FROM json_each(?))",
    )
      .bind(JSON.stringify(["", ...words]))
      .all<{ token: string; spam: number; ham: number }>()
  ).results;
  const totals = rows.find((r) => r.token === "");
  return totals
    ? classify(
        totals,
        rows.filter((r) => r.token !== ""),
      )
    : 0.5;
}
export async function screenArrival(env: Db, box: string, id: string, f: Facts) {
  const p = await senderPolicy(env, box, f.from[0]);
  let reason = headerDecision(p, f);
  if (!reason && p.learn) {
    const score = await learned(env, features(f.subject[0], f.body[0], f.from[0]));
    if (score >= 0.98) reason = "Learned spam pattern";
  }
  const quarantine = !!reason && reason !== "Allowed sender";
  const writes = [
    env.DB.prepare(
      "INSERT INTO mail_assessment SELECT id,mailbox_id,?,? FROM messages WHERE id=? AND mailbox_id=? ON CONFLICT DO NOTHING",
    ).bind(reason || "Passed screening", Number(reason === "Awaiting sender review"), id, box),
  ];
  if (quarantine)
    writes.push(
      env.DB.prepare("UPDATE messages SET folder='spam' WHERE mailbox_id=? AND id=?").bind(box, id),
    );
  return { quarantine, writes };
}
