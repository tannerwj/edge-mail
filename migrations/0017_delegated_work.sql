CREATE TABLE agent_requests(
 grant_id TEXT NOT NULL REFERENCES agent_grants, mailbox_id TEXT NOT NULL REFERENCES mailboxes,
 request_key TEXT NOT NULL, digest TEXT NOT NULL, draft_id TEXT NOT NULL,
 PRIMARY KEY(grant_id,mailbox_id,request_key)
);
CREATE TABLE delegated_rules(
 rule_id TEXT NOT NULL, revision INTEGER NOT NULL, grant_id TEXT NOT NULL REFERENCES agent_grants,
 actor TEXT NOT NULL REFERENCES users,mailbox_id TEXT NOT NULL REFERENCES mailboxes,
 audience TEXT NOT NULL,audit_id TEXT NOT NULL UNIQUE,undone INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(rule_id,revision),FOREIGN KEY(rule_id,revision) REFERENCES rule_versions
);
CREATE TRIGGER cancel_delegated_work AFTER UPDATE OF revoked ON agent_grants
WHEN OLD.revoked IS NULL AND NEW.revoked IS NOT NULL BEGIN
 UPDATE outbox SET state='cancelled',error_code='authorization_changed',reserved_day=NULL
 WHERE state IN('held','deferred') AND json_extract(letter,'$.agent_grant') IN
 (WITH RECURSIVE children(id) AS (SELECT NEW.id UNION ALL SELECT g.id FROM agent_grants g JOIN children c ON g.parent=c.id) SELECT id FROM children);
END;
CREATE TRIGGER snapshot_agent_requests_insert AFTER INSERT ON agent_requests
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'agent_requests',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='agent_requests' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_agent_requests_update AFTER UPDATE ON agent_requests
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'agent_requests',OLD.rowid,json_object('grant_id',OLD.grant_id,'mailbox_id',OLD.mailbox_id,'request_key',OLD.request_key,'digest',OLD.digest,'draft_id',OLD.draft_id) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='agent_requests' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_agent_requests_delete AFTER DELETE ON agent_requests
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'agent_requests',OLD.rowid,json_object('grant_id',OLD.grant_id,'mailbox_id',OLD.mailbox_id,'request_key',OLD.request_key,'digest',OLD.digest,'draft_id',OLD.draft_id) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='agent_requests' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_delegated_rules_insert AFTER INSERT ON delegated_rules
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'delegated_rules',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='delegated_rules' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_delegated_rules_update AFTER UPDATE ON delegated_rules
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'delegated_rules',OLD.rowid,json_object('rule_id',OLD.rule_id,'revision',OLD.revision,'grant_id',OLD.grant_id,'actor',OLD.actor,'mailbox_id',OLD.mailbox_id,'audience',OLD.audience,'audit_id',OLD.audit_id,'undone',OLD.undone) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='delegated_rules' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_delegated_rules_delete AFTER DELETE ON delegated_rules
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'delegated_rules',OLD.rowid,json_object('rule_id',OLD.rule_id,'revision',OLD.revision,'grant_id',OLD.grant_id,'actor',OLD.actor,'mailbox_id',OLD.mailbox_id,'audience',OLD.audience,'audit_id',OLD.audit_id,'undone',OLD.undone) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='delegated_rules' AND seq=OLD.rowid);
END;
-- A restored instance gets a new epoch. Old delta cursors return an explicit resync response.
CREATE TABLE change_stream(id INTEGER PRIMARY KEY CHECK(id=1),epoch TEXT NOT NULL,floor INTEGER NOT NULL DEFAULT 0);
INSERT INTO change_stream VALUES(1,lower(hex(randomblob(12))),0);
CREATE TABLE changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,mailbox_id TEXT NOT NULL,entity TEXT NOT NULL,kind TEXT NOT NULL,actor TEXT,at INTEGER NOT NULL);
CREATE INDEX mailbox_changes ON changes(mailbox_id,seq);
CREATE INDEX expired_changes ON changes(at,seq);
CREATE TRIGGER feed_received AFTER INSERT ON messages BEGIN
 INSERT INTO changes(mailbox_id,entity,kind,actor,at) VALUES(NEW.mailbox_id,NEW.id,CASE WHEN NEW.folder='sent' THEN 'sent' ELSE 'received' END,NULL,unixepoch()*1000);
END;
CREATE TRIGGER feed_organized AFTER UPDATE OF FOLDER,IS_READ,STARRED ON messages BEGIN
 INSERT INTO changes(mailbox_id,entity,kind,actor,at) VALUES(NEW.mailbox_id,NEW.id,'organized',NULL,unixepoch()*1000);
END;
CREATE TRIGGER feed_removed AFTER DELETE ON messages BEGIN
 INSERT INTO changes(mailbox_id,entity,kind,actor,at) VALUES(OLD.mailbox_id,OLD.id,'removed',NULL,unixepoch()*1000);
END;
CREATE TRIGGER feed_label_added AFTER INSERT ON message_labels BEGIN
 INSERT INTO changes(mailbox_id,entity,kind,actor,at) VALUES(NEW.mailbox_id,NEW.message_id,'label_added',NULL,unixepoch()*1000);
END;
CREATE TRIGGER feed_label_removed AFTER DELETE ON message_labels BEGIN
 INSERT INTO changes(mailbox_id,entity,kind,actor,at) VALUES(OLD.mailbox_id,OLD.message_id,'label_removed',NULL,unixepoch()*1000);
END;
CREATE TRIGGER feed_draft_created AFTER INSERT ON drafts BEGIN
 INSERT INTO changes(mailbox_id,entity,kind,actor,at) VALUES(NEW.mailbox_id,NEW.id,'draft_created',NEW.actor,unixepoch()*1000);
END;
CREATE TRIGGER feed_draft_updated AFTER UPDATE ON drafts BEGIN
 INSERT INTO changes(mailbox_id,entity,kind,actor,at) VALUES(NEW.mailbox_id,NEW.id,'draft_updated',NEW.actor,unixepoch()*1000);
END;
CREATE TRIGGER feed_draft_closed AFTER DELETE ON drafts BEGIN
 INSERT INTO changes(mailbox_id,entity,kind,actor,at) VALUES(OLD.mailbox_id,OLD.id,'draft_closed',OLD.actor,unixepoch()*1000);
END;
CREATE TRIGGER feed_outbox_created AFTER INSERT ON outbox BEGIN
 INSERT INTO changes(mailbox_id,entity,kind,actor,at) VALUES(NEW.mailbox_id,NEW.id,'outbox_created',NEW.actor,unixepoch()*1000);
END;
CREATE TRIGGER feed_outbox_updated AFTER UPDATE OF STATE ON outbox BEGIN
 INSERT INTO changes(mailbox_id,entity,kind,actor,at) VALUES(NEW.mailbox_id,NEW.id,'outbox_updated',NEW.actor,unixepoch()*1000);
END;
