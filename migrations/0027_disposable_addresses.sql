CREATE TABLE temporary_addresses(canonical TEXT PRIMARY KEY,mailbox_id TEXT NOT NULL REFERENCES mailboxes,label TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER,disabled INTEGER NOT NULL DEFAULT 0,first_sender TEXT,first_at TEXT,window INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,reason TEXT);
CREATE INDEX temporary_box ON temporary_addresses(mailbox_id,created);
CREATE TABLE receipt_preferences(mailbox_id TEXT PRIMARY KEY REFERENCES mailboxes,label_plus INTEGER NOT NULL DEFAULT 1);
CREATE TABLE unknown_recipient_policy(domain_id TEXT PRIMARY KEY REFERENCES domains,mode TEXT NOT NULL CHECK(mode IN('reject','drop','deliver')),mailbox_id TEXT REFERENCES mailboxes);
CREATE TRIGGER temporary_unique BEFORE INSERT ON temporary_addresses WHEN EXISTS(SELECT 1 FROM addresses WHERE canonical=NEW.canonical) BEGIN SELECT RAISE(ABORT,'Address already exists'); END;
CREATE TRIGGER permanent_unique BEFORE INSERT ON addresses WHEN EXISTS(SELECT 1 FROM temporary_addresses WHERE canonical=NEW.canonical) BEGIN SELECT RAISE(ABORT,'Address already exists'); END;
CREATE TRIGGER temporary_first AFTER INSERT ON deliveries WHEN NEW.kind='disposable' BEGIN
 UPDATE temporary_addresses SET first_sender=NEW.envelope_from,first_at=NEW.received_at WHERE mailbox_id=NEW.mailbox_id AND canonical=NEW.matched_address AND (first_at IS NULL OR first_at>NEW.received_at);
END;
CREATE TRIGGER snapshot_temporary_addresses_insert AFTER INSERT ON temporary_addresses
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'temporary_addresses',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='temporary_addresses' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_temporary_addresses_delete AFTER DELETE ON temporary_addresses
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'temporary_addresses',OLD.rowid,json_object('canonical',OLD.canonical,'mailbox_id',OLD.mailbox_id,'label',OLD.label,'created',OLD.created,'expires',OLD.expires,'disabled',OLD.disabled,'first_sender',OLD.first_sender,'first_at',OLD.first_at,'window',OLD.window,'attempts',OLD.attempts,'reason',OLD.reason) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='temporary_addresses' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_temporary_addresses_update AFTER UPDATE ON temporary_addresses
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'temporary_addresses',OLD.rowid,json_object('canonical',OLD.canonical,'mailbox_id',OLD.mailbox_id,'label',OLD.label,'created',OLD.created,'expires',OLD.expires,'disabled',OLD.disabled,'first_sender',OLD.first_sender,'first_at',OLD.first_at,'window',OLD.window,'attempts',OLD.attempts,'reason',OLD.reason) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='temporary_addresses' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_receipt_preferences_insert AFTER INSERT ON receipt_preferences
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'receipt_preferences',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='receipt_preferences' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_receipt_preferences_delete AFTER DELETE ON receipt_preferences
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'receipt_preferences',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'label_plus',OLD.label_plus) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='receipt_preferences' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_receipt_preferences_update AFTER UPDATE ON receipt_preferences
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'receipt_preferences',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'label_plus',OLD.label_plus) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='receipt_preferences' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_unknown_recipient_policy_insert AFTER INSERT ON unknown_recipient_policy
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'unknown_recipient_policy',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='unknown_recipient_policy' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_unknown_recipient_policy_delete AFTER DELETE ON unknown_recipient_policy
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'unknown_recipient_policy',OLD.rowid,json_object('domain_id',OLD.domain_id,'mode',OLD.mode,'mailbox_id',OLD.mailbox_id) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='unknown_recipient_policy' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_unknown_recipient_policy_update AFTER UPDATE ON unknown_recipient_policy
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'unknown_recipient_policy',OLD.rowid,json_object('domain_id',OLD.domain_id,'mode',OLD.mode,'mailbox_id',OLD.mailbox_id) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='unknown_recipient_policy' AND seq=OLD.rowid);
END;
CREATE TABLE apex_route_ownership(domain TEXT PRIMARY KEY,worker TEXT NOT NULL,prior TEXT NOT NULL);
