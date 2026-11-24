CREATE TABLE dmarc_mailboxes(mailbox_id TEXT PRIMARY KEY REFERENCES mailboxes,enabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE dmarc_reports(mailbox_id TEXT NOT NULL,message_id TEXT NOT NULL,issuer TEXT NOT NULL,reporter TEXT NOT NULL,reference TEXT NOT NULL,domain TEXT NOT NULL,begin INTEGER NOT NULL,end INTEGER NOT NULL,total INTEGER NOT NULL,aligned INTEGER NOT NULL,rejected INTEGER NOT NULL,quarantined INTEGER NOT NULL,PRIMARY KEY(mailbox_id,reporter,issuer,reference,domain),FOREIGN KEY(mailbox_id,message_id) REFERENCES messages(mailbox_id,id) ON DELETE CASCADE);
CREATE INDEX dmarc_dashboard ON dmarc_reports(mailbox_id,end DESC);
CREATE TRIGGER snapshot_dmarc_mailboxes_insert AFTER INSERT ON dmarc_mailboxes
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'dmarc_mailboxes',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='dmarc_mailboxes' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_dmarc_mailboxes_update AFTER UPDATE ON dmarc_mailboxes
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'dmarc_mailboxes',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'enabled',OLD.enabled) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='dmarc_mailboxes' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_dmarc_mailboxes_delete AFTER DELETE ON dmarc_mailboxes
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'dmarc_mailboxes',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'enabled',OLD.enabled) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='dmarc_mailboxes' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_dmarc_reports_insert AFTER INSERT ON dmarc_reports
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'dmarc_reports',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='dmarc_reports' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_dmarc_reports_update AFTER UPDATE ON dmarc_reports
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'dmarc_reports',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'message_id',OLD.message_id,'issuer',OLD.issuer,'reporter',OLD.reporter,'reference',OLD.reference,'domain',OLD.domain,'begin',OLD.begin,'end',OLD.end,'total',OLD.total,'aligned',OLD.aligned,'rejected',OLD.rejected,'quarantined',OLD.quarantined) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='dmarc_reports' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_dmarc_reports_delete AFTER DELETE ON dmarc_reports
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'dmarc_reports',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'message_id',OLD.message_id,'issuer',OLD.issuer,'reporter',OLD.reporter,'reference',OLD.reference,'domain',OLD.domain,'begin',OLD.begin,'end',OLD.end,'total',OLD.total,'aligned',OLD.aligned,'rejected',OLD.rejected,'quarantined',OLD.quarantined) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='dmarc_reports' AND seq=OLD.rowid);
END;
