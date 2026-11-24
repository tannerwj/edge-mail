import type { Bindings } from "../env";
export const visibleInbox = `NOT EXISTS(SELECT 1 FROM thread_state s WHERE s.mailbox_id=m.mailbox_id AND s.thread_id=t.thread_id AND s.snoozed_until>unixepoch()*1000) AND NOT EXISTS(SELECT 1 FROM message_wakes w WHERE w.message_id=m.id AND w.until>unixepoch()*1000)`;
export const snoozedMail = `EXISTS(SELECT 1 FROM thread_state s WHERE s.mailbox_id=m.mailbox_id AND s.thread_id=t.thread_id AND s.snoozed_until>unixepoch()*1000) OR EXISTS(SELECT 1 FROM message_wakes w WHERE w.message_id=m.id AND w.until>unixepoch()*1000)`;
export const followUpMail = `EXISTS(SELECT 1 FROM thread_state s WHERE s.mailbox_id=m.mailbox_id AND s.thread_id=t.thread_id AND s.follow_up_at IS NOT NULL)`;
export function threadState(env: Bindings, box: string, id: string) {
  return env.DB.prepare(
    "SELECT t.thread_id,s.muted,s.snoozed_until,s.follow_up_at,s.if_no_reply,s.follow_ready FROM thread_members t LEFT JOIN thread_state s ON s.mailbox_id=t.mailbox_id AND s.thread_id=t.thread_id WHERE t.mailbox_id=? AND t.message_id=?",
  )
    .bind(box, id)
    .first();
}
