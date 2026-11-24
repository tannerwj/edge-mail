CREATE TABLE thread_state(
 mailbox_id TEXT NOT NULL REFERENCES mailboxes,thread_id TEXT NOT NULL,muted INTEGER NOT NULL DEFAULT 0,snoozed_until INTEGER,
 follow_up_at INTEGER,if_no_reply INTEGER NOT NULL DEFAULT 1,follow_ready INTEGER NOT NULL DEFAULT 0,revision TEXT NOT NULL,
 PRIMARY KEY(mailbox_id,thread_id),FOREIGN KEY(mailbox_id,thread_id) REFERENCES messages(mailbox_id,id) ON DELETE CASCADE
);
CREATE INDEX thread_snooze_due ON thread_state(snoozed_until) WHERE snoozed_until IS NOT NULL;
CREATE INDEX thread_follow_due ON thread_state(follow_up_at) WHERE follow_up_at IS NOT NULL AND follow_ready=0;
CREATE TABLE message_wakes(message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,mailbox_id TEXT NOT NULL REFERENCES mailboxes,until INTEGER NOT NULL);
CREATE INDEX message_wake_due ON message_wakes(until);
CREATE TABLE timer_undo(audit_id TEXT NOT NULL REFERENCES agent_audit,thread_id TEXT NOT NULL,before_state TEXT NOT NULL,undone INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(audit_id,thread_id));
CREATE TRIGGER conversation_arrival AFTER INSERT ON thread_members
WHEN EXISTS(SELECT 1 FROM deliveries d WHERE d.message_id=NEW.message_id AND d.kind!='import') BEGIN
 UPDATE thread_state SET follow_up_at=NULL,follow_ready=0,revision=lower(hex(randomblob(16))) WHERE mailbox_id=NEW.mailbox_id AND thread_id=NEW.thread_id AND if_no_reply=1 AND follow_up_at IS NOT NULL;
 UPDATE messages SET folder='archive' WHERE id=NEW.message_id AND folder='inbox' AND EXISTS(SELECT 1 FROM thread_state s WHERE s.mailbox_id=NEW.mailbox_id AND s.thread_id=NEW.thread_id AND muted=1);
END;
CREATE TRIGGER thread_reminder_feed AFTER UPDATE ON thread_state BEGIN
 INSERT INTO changes(mailbox_id,entity,kind,at) VALUES(NEW.mailbox_id,NEW.thread_id,'reminder',unixepoch()*1000);
END;
CREATE TRIGGER thread_reminder_added AFTER INSERT ON thread_state BEGIN
 INSERT INTO changes(mailbox_id,entity,kind,at) VALUES(NEW.mailbox_id,NEW.thread_id,'reminder',unixepoch()*1000);
END;
CREATE TRIGGER followup_notify AFTER UPDATE ON thread_state WHEN NEW.follow_ready=1 AND OLD.follow_ready=0 BEGIN
 INSERT OR IGNORE INTO push_jobs(event,device,mailbox_id,topic,due) SELECT NEW.thread_id,d.id,NEW.mailbox_id,'followup',unixepoch()*1000 FROM push_devices d JOIN users u ON u.id=d.actor AND u.disabled_at IS NULL WHERE d.new_mail=1 AND (u.role IN ('admin','owner') OR EXISTS(SELECT 1 FROM mailbox_members m WHERE m.mailbox_id=NEW.mailbox_id AND m.user_id=u.id));
END;
CREATE TRIGGER snapshot_thread_state_insert AFTER INSERT ON thread_state
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'thread_state',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='thread_state' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_thread_state_update AFTER UPDATE ON thread_state
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'thread_state',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'thread_id',OLD.thread_id,'muted',OLD.muted,'snoozed_until',OLD.snoozed_until,'follow_up_at',OLD.follow_up_at,'if_no_reply',OLD.if_no_reply,'follow_ready',OLD.follow_ready,'revision',OLD.revision) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='thread_state' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_thread_state_delete AFTER DELETE ON thread_state
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'thread_state',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'thread_id',OLD.thread_id,'muted',OLD.muted,'snoozed_until',OLD.snoozed_until,'follow_up_at',OLD.follow_up_at,'if_no_reply',OLD.if_no_reply,'follow_ready',OLD.follow_ready,'revision',OLD.revision) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='thread_state' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_message_wakes_insert AFTER INSERT ON message_wakes
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'message_wakes',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='message_wakes' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_message_wakes_update AFTER UPDATE ON message_wakes
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'message_wakes',OLD.rowid,json_object('message_id',OLD.message_id,'mailbox_id',OLD.mailbox_id,'until',OLD.until) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='message_wakes' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_message_wakes_delete AFTER DELETE ON message_wakes
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'message_wakes',OLD.rowid,json_object('message_id',OLD.message_id,'mailbox_id',OLD.mailbox_id,'until',OLD.until) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='message_wakes' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_timer_undo_insert AFTER INSERT ON timer_undo
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'timer_undo',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='timer_undo' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_timer_undo_update AFTER UPDATE ON timer_undo
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'timer_undo',OLD.rowid,json_object('audit_id',OLD.audit_id,'thread_id',OLD.thread_id,'before_state',OLD.before_state,'undone',OLD.undone) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='timer_undo' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_timer_undo_delete AFTER DELETE ON timer_undo
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'timer_undo',OLD.rowid,json_object('audit_id',OLD.audit_id,'thread_id',OLD.thread_id,'before_state',OLD.before_state,'undone',OLD.undone) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='timer_undo' AND seq=OLD.rowid);
END;
