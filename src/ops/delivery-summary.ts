import type { Bindings } from "../env";
// Only summarize recipients visible in the shared Sent copy. A later complaint survives delivery.
export async function deliverySummary(env: Bindings, box: string, message: string) {
  const result = await env.DB.prepare(`WITH visible AS (
      SELECT e.recipient,e.kind,e.at,e.event_id FROM outbox o JOIN delivery_events e ON e.provider=o.provider
      AND e.domain=substr(o.from_addr,instr(o.from_addr,'@')+1) AND e.provider_id=trim(o.provider_id,'<>')
      WHERE o.id=? AND o.mailbox_id=? AND e.recipient IN
        (SELECT lower(value) FROM json_each(o.letter,'$.to') UNION SELECT lower(value) FROM json_each(o.letter,'$.cc'))
    ), ranked AS (
      SELECT kind,row_number() OVER (PARTITION BY recipient,(kind='complained')
        ORDER BY (kind<>'deferred') DESC,at DESC,event_id DESC) AS n FROM visible
    ) SELECT kind,count(*) AS recipients FROM ranked WHERE n=1 GROUP BY kind ORDER BY kind`)
    .bind(message, box)
    .all<{ kind: string; recipients: number }>();
  return result.results;
}
