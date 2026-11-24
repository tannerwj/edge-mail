import type { Attachment } from "postal-mime";
import { parseAggregate } from "../dmarc";
import { Problem, type Bindings } from "../env";
import type { User } from "./access";
import { owning, owner } from "./destinations";
import type { Receipt } from "./receipt";
const enabled =
  "SELECT b.id FROM dmarc_mailboxes r JOIN mailboxes b ON b.id=r.mailbox_id JOIN domains d ON d.id=b.domain_id WHERE r.mailbox_id=? AND r.enabled=1 AND d.name=?";
export async function reportStatements(
  env: Pick<Bindings, "DB">,
  meta: Receipt,
  attachments: Attachment[],
  hash: string,
  from: string,
) {
  if (meta.kind === "import" || meta.auth.dmarc !== "pass") return [];
  const files = attachments.filter((a) => /\.(?:xml|gz|zip)$/i.test(a.filename || "")).slice(0, 4);
  if (
    !files.length ||
    !(await env.DB.prepare("SELECT 1 FROM dmarc_mailboxes WHERE mailbox_id=? AND enabled=1")
      .bind(meta.mailbox)
      .first())
  )
    return [];
  const reporter = from.split("@").at(-1)?.toLowerCase();
  if (!reporter || !from.includes("@")) return [];
  const statements: D1PreparedStatement[] = [];
  for (const a of files) {
    if (typeof a.content === "string") continue;
    const report = parseAggregate(a.filename || "", new Uint8Array(a.content));
    if (!report) continue;
    const { issuer, reference, domain, begin, end, total, aligned, rejected, quarantined } = report;
    statements.push(
      env.DB.prepare(
        "INSERT INTO dmarc_reports(mailbox_id,message_id,issuer,reporter,reference,domain,begin,end,total,aligned,rejected,quarantined) SELECT mailbox_id,id,?,?,?,?,?,?,?,?,?,? FROM messages WHERE mailbox_id IN(" +
          enabled +
          ") AND content_hash=? ON CONFLICT DO NOTHING",
      ).bind(
        issuer,
        reporter,
        reference,
        domain,
        begin,
        end,
        total,
        aligned,
        rejected,
        quarantined,
        meta.mailbox,
        domain,
        hash,
      ),
    );
  }
  return statements;
}
export async function reportDashboard(env: Bindings, u: User, box: string, on?: unknown) {
  await owner(env, u, box);
  if (on !== undefined) {
    if (typeof on !== "boolean")
      throw new Problem(400, "Choose whether to collect aggregate reports");
    const write = await env.DB.prepare(
      "INSERT INTO dmarc_mailboxes SELECT id,? FROM mailboxes WHERE id IN(" +
        owning +
        ") ON CONFLICT(mailbox_id) DO UPDATE SET enabled=excluded.enabled",
    )
      .bind(Number(on), u.id, box)
      .run();
    if (!write.meta.changes) throw new Problem(403, "Mailbox owner required");
  }
  const rows = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT enabled FROM dmarc_mailboxes WHERE mailbox_id IN(" + owning + ")").bind(
      u.id,
      box,
    ),
    env.DB.prepare(
      "SELECT r.message_id,r.issuer,r.reporter,r.domain,r.begin,r.end,r.total,r.aligned,r.rejected,r.quarantined FROM dmarc_reports r JOIN messages m ON m.id=r.message_id AND m.body_key!='erased' WHERE r.mailbox_id IN(" +
        owning +
        ") ORDER BY end DESC,message_id DESC LIMIT 100",
    ).bind(u.id, box),
  ]);
  return { enabled: rows[0].results[0]?.enabled === 1, reports: rows[1].results };
}
