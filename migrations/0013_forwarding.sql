CREATE TABLE egress_destinations (
 id TEXT PRIMARY KEY, mailbox_id TEXT NOT NULL REFERENCES mailboxes, owner TEXT NOT NULL REFERENCES users,
 address TEXT COLLATE NOCASE NOT NULL, verified_at TEXT, disabled INTEGER NOT NULL DEFAULT 0,
 UNIQUE(mailbox_id,address)
);
CREATE TABLE forward_attempts (
 id TEXT PRIMARY KEY, mailbox_id TEXT NOT NULL REFERENCES mailboxes, rule_id TEXT NOT NULL, revision INTEGER NOT NULL,
 destination TEXT NOT NULL REFERENCES egress_destinations, source TEXT NOT NULL, sender TEXT NOT NULL,
 mode TEXT NOT NULL, state TEXT NOT NULL, reason TEXT, at INTEGER NOT NULL, outbox_id TEXT, content_hash TEXT, source_message TEXT,
 UNIQUE(mailbox_id,source,destination), FOREIGN KEY(rule_id,revision) REFERENCES rule_versions
);
CREATE INDEX forward_hash ON forward_attempts(destination,content_hash,at);
CREATE UNIQUE INDEX forward_outbox ON forward_attempts(outbox_id) WHERE outbox_id IS NOT NULL;
CREATE INDEX forward_rates ON forward_attempts(mailbox_id,sender,at);
CREATE TRIGGER offboard_destinations AFTER UPDATE OF disabled_at ON users
WHEN NEW.disabled_at IS NOT NULL AND OLD.disabled_at IS NULL BEGIN
 UPDATE egress_destinations SET disabled=1 WHERE owner=NEW.id;
END;
CREATE TRIGGER snapshot_egress_destinations_insert AFTER INSERT ON egress_destinations
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'egress_destinations',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='egress_destinations' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_egress_destinations_update AFTER UPDATE ON egress_destinations
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'egress_destinations',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'owner',OLD.owner,'address',OLD.address,'verified_at',OLD.verified_at,'disabled',OLD.disabled) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='egress_destinations' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_egress_destinations_delete AFTER DELETE ON egress_destinations
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'egress_destinations',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'owner',OLD.owner,'address',OLD.address,'verified_at',OLD.verified_at,'disabled',OLD.disabled) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='egress_destinations' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_forward_attempts_insert AFTER INSERT ON forward_attempts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'forward_attempts',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='forward_attempts' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_forward_attempts_update AFTER UPDATE ON forward_attempts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'forward_attempts',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'rule_id',OLD.rule_id,'revision',OLD.revision,'destination',OLD.destination,'source',OLD.source,'sender',OLD.sender,'mode',OLD.mode,'state',OLD.state,'reason',OLD.reason,'at',OLD.at,'outbox_id',OLD.outbox_id,'content_hash',OLD.content_hash,'source_message',OLD.source_message) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='forward_attempts' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_forward_attempts_delete AFTER DELETE ON forward_attempts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'forward_attempts',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'rule_id',OLD.rule_id,'revision',OLD.revision,'destination',OLD.destination,'source',OLD.source,'sender',OLD.sender,'mode',OLD.mode,'state',OLD.state,'reason',OLD.reason,'at',OLD.at,'outbox_id',OLD.outbox_id,'content_hash',OLD.content_hash,'source_message',OLD.source_message) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='forward_attempts' AND seq=OLD.rowid);
END;

CREATE TRIGGER forward_outcome AFTER UPDATE OF state ON outbox WHEN NEW.state IN ('sent','failed','uncertain','cancelled') BEGIN
 UPDATE forward_attempts SET state=CASE NEW.state WHEN 'sent' THEN 'submitted' ELSE NEW.state END,reason=NEW.error_code WHERE outbox_id=NEW.id;
END;
