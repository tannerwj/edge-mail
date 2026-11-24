import type { Bindings } from "../env";
import { messageIds, subjectKey } from "../threading";
import type { Receipt } from "./receipt";

type Headers = {
  subject: string;
  sender: string;
  hash: string;
  parent: string;
  references: string;
  automated: boolean;
};
export function indexConversation(env: Pick<Bindings, "DB">, meta: Receipt, mail: Headers) {
  // Join and assign in the same D1 batch as message creation. Duplicate deliveries keep the first assignment.
  const references = [...messageIds(mail.parent), ...messageIds(mail.references).reverse()].slice(
    0,
    80,
  );
  return env.DB.prepare(`WITH incoming AS (
      SELECT id,mailbox_id,received_at,lower(sender) AS sender_key,? AS subject_key,? AS automated
      FROM messages WHERE mailbox_id=? AND content_hash=?
    ), reference_match AS (
      SELECT t.thread_id FROM incoming i JOIN json_each(?) r
      JOIN messages parent ON parent.mailbox_id=i.mailbox_id AND parent.wire_id=r.value AND parent.synthetic=0
      JOIN thread_members t ON t.mailbox_id=i.mailbox_id AND t.message_id=parent.id
      WHERE i.automated=0 AND t.automated=0 AND (EXISTS(SELECT 1 FROM thread_members participant
        WHERE participant.mailbox_id=i.mailbox_id AND participant.thread_id=t.thread_id AND participant.sender_key=i.sender_key)
        OR EXISTS(SELECT 1 FROM outbox sent WHERE sent.id=parent.id AND sent.mailbox_id=i.mailbox_id
          AND sent.state='sent' AND i.sender_key IN
          (SELECT value FROM json_each(sent.letter,'$.to') UNION ALL SELECT value FROM json_each(sent.letter,'$.cc'))))
      ORDER BY r.key,parent.received_at DESC,parent.id DESC LIMIT 1
    ), subject_match AS (
      SELECT t.thread_id FROM incoming i JOIN thread_members t ON t.mailbox_id=i.mailbox_id
        AND t.subject_key=i.subject_key AND t.sender_key=i.sender_key
      JOIN messages m ON m.mailbox_id=t.mailbox_id AND m.id=t.message_id
      WHERE i.automated=0 AND t.automated=0 AND i.subject_key!=''
        AND julianday(i.received_at)-julianday(m.received_at) BETWEEN 0 AND 30
      ORDER BY m.received_at DESC,m.id DESC LIMIT 1
    )
    INSERT INTO thread_members SELECT i.mailbox_id,i.id,
      CASE WHEN i.sender_key='' OR EXISTS(SELECT 1 FROM addresses a WHERE a.mailbox_id=i.mailbox_id AND a.canonical=i.sender_key)
      THEN i.id ELSE COALESCE((SELECT thread_id FROM reference_match),(SELECT thread_id FROM subject_match),i.id) END,
      i.sender_key,i.subject_key,i.automated FROM incoming i WHERE true ON CONFLICT DO NOTHING`).bind(
    subjectKey(mail.subject),
    Number(mail.automated),
    meta.mailbox,
    mail.hash,
    JSON.stringify(references),
  );
}
