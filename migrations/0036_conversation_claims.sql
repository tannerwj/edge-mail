CREATE TABLE conversation_claims(
 mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
 thread_id TEXT NOT NULL,
 actor TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(mailbox_id,thread_id)
);
CREATE INDEX claims_by_actor ON conversation_claims(actor);
CREATE TRIGGER release_disabled_claims AFTER UPDATE OF disabled_at ON users WHEN NEW.disabled_at IS NOT NULL BEGIN
 DELETE FROM conversation_claims WHERE actor=NEW.id;
END;
CREATE TRIGGER release_removed_member AFTER DELETE ON mailbox_members BEGIN
 DELETE FROM conversation_claims WHERE mailbox_id=OLD.mailbox_id AND actor=OLD.user_id;
END;
CREATE TRIGGER release_reader_claims AFTER UPDATE OF role ON mailbox_members WHEN NEW.role='reader' BEGIN
 DELETE FROM conversation_claims WHERE mailbox_id=NEW.mailbox_id AND actor=NEW.user_id;
END;
CREATE TRIGGER release_empty_thread AFTER DELETE ON thread_members WHEN NOT EXISTS(
 SELECT 1 FROM thread_members WHERE mailbox_id=OLD.mailbox_id AND thread_id=OLD.thread_id
) BEGIN
 DELETE FROM conversation_claims WHERE mailbox_id=OLD.mailbox_id AND thread_id=OLD.thread_id;
END;
CREATE TRIGGER snapshot_conversation_claims_insert AFTER INSERT ON conversation_claims
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'conversation_claims',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='conversation_claims' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_conversation_claims_update AFTER UPDATE ON conversation_claims
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'conversation_claims',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'thread_id',OLD.thread_id,'actor',OLD.actor) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='conversation_claims' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_conversation_claims_delete AFTER DELETE ON conversation_claims
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'conversation_claims',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'thread_id',OLD.thread_id,'actor',OLD.actor) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='conversation_claims' AND seq=OLD.rowid);
END;
