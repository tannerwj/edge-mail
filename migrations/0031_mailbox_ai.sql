CREATE TABLE mailbox_ai(mailbox_id TEXT PRIMARY KEY REFERENCES mailboxes,enabled INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL DEFAULT '', calls INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER snapshot_mailbox_ai_insert AFTER INSERT ON mailbox_ai
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'mailbox_ai',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='mailbox_ai' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_mailbox_ai_update AFTER UPDATE ON mailbox_ai
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'mailbox_ai',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'enabled',OLD.enabled,'day',OLD.day,'calls',OLD.calls) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='mailbox_ai' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_mailbox_ai_delete AFTER DELETE ON mailbox_ai
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'mailbox_ai',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'enabled',OLD.enabled,'day',OLD.day,'calls',OLD.calls) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='mailbox_ai' AND seq=OLD.rowid);
END;
