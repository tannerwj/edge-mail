CREATE TABLE saved_searches(mailbox_id TEXT NOT NULL REFERENCES mailboxes,actor TEXT NOT NULL REFERENCES users,query TEXT NOT NULL,PRIMARY KEY(mailbox_id,actor,query));
CREATE INDEX unread_inbox ON messages(mailbox_id,received_at DESC,id DESC) WHERE folder='inbox' AND is_read=0;
CREATE TRIGGER snapshot_saved_searches_insert AFTER INSERT ON saved_searches
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'saved_searches',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='saved_searches' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_saved_searches_update AFTER UPDATE ON saved_searches
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'saved_searches',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'actor',OLD.actor,'query',OLD.query) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='saved_searches' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_saved_searches_delete AFTER DELETE ON saved_searches
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'saved_searches',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'actor',OLD.actor,'query',OLD.query) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='saved_searches' AND seq=OLD.rowid);
END;
