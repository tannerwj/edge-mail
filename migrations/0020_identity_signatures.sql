CREATE TABLE identity_signatures (
 mailbox_id TEXT NOT NULL REFERENCES mailboxes,address TEXT NOT NULL,signature TEXT NOT NULL,PRIMARY KEY(mailbox_id,address)
);
CREATE TRIGGER snapshot_identity_signatures_insert AFTER INSERT ON identity_signatures
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'identity_signatures',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='identity_signatures' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_identity_signatures_update AFTER UPDATE ON identity_signatures
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'identity_signatures',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'address',OLD.address,'signature',OLD.signature) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='identity_signatures' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_identity_signatures_delete AFTER DELETE ON identity_signatures
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'identity_signatures',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'address',OLD.address,'signature',OLD.signature) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='identity_signatures' AND seq=OLD.rowid);
END;
