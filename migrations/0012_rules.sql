CREATE TABLE rule_versions (
 rule_id TEXT NOT NULL, revision INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('instance','domain','mailbox')),
 scope_id TEXT NOT NULL, owner TEXT NOT NULL REFERENCES users, editor TEXT NOT NULL REFERENCES users,
 document TEXT NOT NULL CHECK(json_valid(document)), at TEXT NOT NULL, PRIMARY KEY(rule_id,revision)
);
CREATE INDEX rule_scopes ON rule_versions(scope,scope_id,rule_id,revision DESC);
CREATE TABLE rule_runs (
 execution_id TEXT NOT NULL, rule_id TEXT NOT NULL, revision INTEGER NOT NULL, mailbox_id TEXT NOT NULL, message_id TEXT NOT NULL,
 actions TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(rule_id,message_id),
 FOREIGN KEY(rule_id,revision) REFERENCES rule_versions, FOREIGN KEY(mailbox_id,message_id) REFERENCES messages(mailbox_id,id)
);
CREATE INDEX rule_runs_recent ON rule_runs(rule_id,at DESC);
CREATE TRIGGER snapshot_rule_versions_insert AFTER INSERT ON rule_versions
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'rule_versions',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='rule_versions' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_rule_versions_update AFTER UPDATE ON rule_versions
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'rule_versions',OLD.rowid,json_object('rule_id',OLD.rule_id,'revision',OLD.revision,'scope',OLD.scope,'scope_id',OLD.scope_id,'owner',OLD.owner,'editor',OLD.editor,'document',OLD.document,'at',OLD.at) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='rule_versions' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_rule_versions_delete AFTER DELETE ON rule_versions
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'rule_versions',OLD.rowid,json_object('rule_id',OLD.rule_id,'revision',OLD.revision,'scope',OLD.scope,'scope_id',OLD.scope_id,'owner',OLD.owner,'editor',OLD.editor,'document',OLD.document,'at',OLD.at) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='rule_versions' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_rule_runs_insert AFTER INSERT ON rule_runs
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'rule_runs',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='rule_runs' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_rule_runs_update AFTER UPDATE ON rule_runs
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'rule_runs',OLD.rowid,json_object('execution_id',OLD.execution_id,'rule_id',OLD.rule_id,'revision',OLD.revision,'mailbox_id',OLD.mailbox_id,'message_id',OLD.message_id,'actions',OLD.actions,'at',OLD.at) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='rule_runs' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_rule_runs_delete AFTER DELETE ON rule_runs
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'rule_runs',OLD.rowid,json_object('execution_id',OLD.execution_id,'rule_id',OLD.rule_id,'revision',OLD.revision,'mailbox_id',OLD.mailbox_id,'message_id',OLD.message_id,'actions',OLD.actions,'at',OLD.at) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='rule_runs' AND seq=OLD.rowid);
END;
