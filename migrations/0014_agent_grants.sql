CREATE TABLE agent_grants(
 id TEXT PRIMARY KEY,actor TEXT NOT NULL REFERENCES users,parent TEXT REFERENCES agent_grants,
 name TEXT NOT NULL,scopes TEXT NOT NULL CHECK(json_valid(scopes)),boxes TEXT CHECK(boxes IS NULL OR json_valid(boxes)),
 audience TEXT NOT NULL,expires INTEGER NOT NULL,created INTEGER NOT NULL,revoked INTEGER
);
CREATE INDEX grants_actor ON agent_grants(actor,created DESC);
CREATE TABLE agent_tokens(
 digest TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES agent_grants,expires INTEGER NOT NULL,last_used INTEGER
);
CREATE TABLE agent_audit(
 id TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES agent_grants,actor TEXT NOT NULL REFERENCES users,
 mailbox_id TEXT REFERENCES mailboxes,op TEXT NOT NULL,at INTEGER NOT NULL,affected INTEGER NOT NULL
);
CREATE INDEX audit_actor ON agent_audit(actor,at DESC);
CREATE TABLE triage_undo(
 audit_id TEXT NOT NULL REFERENCES agent_audit,message_id TEXT NOT NULL,
 field TEXT NOT NULL,before_value TEXT NOT NULL,after_value TEXT NOT NULL,undone INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(audit_id,message_id)
);
CREATE TRIGGER offboard_agent_grants AFTER UPDATE OF disabled_at ON users
WHEN NEW.disabled_at IS NOT NULL AND OLD.disabled_at IS NULL BEGIN
 UPDATE agent_grants SET revoked=unixepoch()*1000 WHERE actor=NEW.id AND revoked IS NULL;
END;
CREATE TRIGGER snapshot_agent_grants_insert AFTER INSERT ON agent_grants
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'agent_grants',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='agent_grants' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_agent_grants_update AFTER UPDATE ON agent_grants
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'agent_grants',OLD.rowid,json_object('id',OLD.id,'actor',OLD.actor,'parent',OLD.parent,'name',OLD.name,'scopes',OLD.scopes,'boxes',OLD.boxes,'audience',OLD.audience,'expires',OLD.expires,'created',OLD.created,'revoked',OLD.revoked) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='agent_grants' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_agent_grants_delete AFTER DELETE ON agent_grants
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'agent_grants',OLD.rowid,json_object('id',OLD.id,'actor',OLD.actor,'parent',OLD.parent,'name',OLD.name,'scopes',OLD.scopes,'boxes',OLD.boxes,'audience',OLD.audience,'expires',OLD.expires,'created',OLD.created,'revoked',OLD.revoked) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='agent_grants' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_agent_tokens_insert AFTER INSERT ON agent_tokens
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'agent_tokens',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='agent_tokens' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_agent_tokens_update AFTER UPDATE ON agent_tokens
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'agent_tokens',OLD.rowid,json_object('digest',OLD.digest,'grant_id',OLD.grant_id,'expires',OLD.expires,'last_used',OLD.last_used) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='agent_tokens' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_agent_tokens_delete AFTER DELETE ON agent_tokens
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'agent_tokens',OLD.rowid,json_object('digest',OLD.digest,'grant_id',OLD.grant_id,'expires',OLD.expires,'last_used',OLD.last_used) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='agent_tokens' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_agent_audit_insert AFTER INSERT ON agent_audit
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'agent_audit',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='agent_audit' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_agent_audit_update AFTER UPDATE ON agent_audit
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'agent_audit',OLD.rowid,json_object('id',OLD.id,'grant_id',OLD.grant_id,'actor',OLD.actor,'mailbox_id',OLD.mailbox_id,'op',OLD.op,'at',OLD.at,'affected',OLD.affected) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='agent_audit' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_agent_audit_delete AFTER DELETE ON agent_audit
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'agent_audit',OLD.rowid,json_object('id',OLD.id,'grant_id',OLD.grant_id,'actor',OLD.actor,'mailbox_id',OLD.mailbox_id,'op',OLD.op,'at',OLD.at,'affected',OLD.affected) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='agent_audit' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_triage_undo_insert AFTER INSERT ON triage_undo
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'triage_undo',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='triage_undo' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_triage_undo_update AFTER UPDATE ON triage_undo
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'triage_undo',OLD.rowid,json_object('audit_id',OLD.audit_id,'message_id',OLD.message_id,'field',OLD.field,'before_value',OLD.before_value,'after_value',OLD.after_value,'undone',OLD.undone) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='triage_undo' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_triage_undo_delete AFTER DELETE ON triage_undo
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'triage_undo',OLD.rowid,json_object('audit_id',OLD.audit_id,'message_id',OLD.message_id,'field',OLD.field,'before_value',OLD.before_value,'after_value',OLD.after_value,'undone',OLD.undone) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='triage_undo' AND seq=OLD.rowid);
END;
CREATE TABLE agent_code_usage(day TEXT NOT NULL,digest TEXT NOT NULL,calls INTEGER NOT NULL,PRIMARY KEY(day,digest));
CREATE TRIGGER snapshot_agent_code_usage_insert AFTER INSERT ON agent_code_usage
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'agent_code_usage',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='agent_code_usage' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_agent_code_usage_update AFTER UPDATE ON agent_code_usage
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'agent_code_usage',OLD.rowid,json_object('day',OLD.day,'digest',OLD.digest,'calls',OLD.calls) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='agent_code_usage' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_agent_code_usage_delete AFTER DELETE ON agent_code_usage
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'agent_code_usage',OLD.rowid,json_object('day',OLD.day,'digest',OLD.digest,'calls',OLD.calls) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='agent_code_usage' AND seq=OLD.rowid);
END;
