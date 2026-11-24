CREATE TABLE contacts(mailbox_id TEXT NOT NULL REFERENCES mailboxes,address TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',last_seen INTEGER NOT NULL,sent_count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(mailbox_id,address));
CREATE INDEX contact_rank ON contacts(mailbox_id,sent_count DESC,last_seen DESC,address);
CREATE TABLE compose_templates(id TEXT PRIMARY KEY,mailbox_id TEXT NOT NULL REFERENCES mailboxes,actor TEXT NOT NULL REFERENCES users,name TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,rich INTEGER NOT NULL DEFAULT 0,UNIQUE(mailbox_id,actor,name));
CREATE VIEW visible_sent_recipients AS SELECT o.id,o.mailbox_id,lower(r.value) address,unixepoch(o.created_at)*1000 at FROM outbox o,json_each(json_array(json_extract(o.letter,'$.to'),json_extract(o.letter,'$.cc'))) groups_ JOIN json_each(groups_.value) r WHERE o.state='sent' AND json_extract(o.letter,'$.agent_grant') IS NULL AND json_extract(o.letter,'$.vacation') IS NULL AND json_extract(o.letter,'$.forwardedFrom') IS NULL;
INSERT INTO contacts(mailbox_id,address,last_seen,sent_count) SELECT mailbox_id,address,max(at),count(DISTINCT id) FROM visible_sent_recipients GROUP BY mailbox_id,address;
CREATE TRIGGER learn_contact AFTER UPDATE OF state ON outbox WHEN NEW.state='sent' AND OLD.state!='sent' BEGIN
 INSERT INTO contacts(mailbox_id,address,last_seen,sent_count) SELECT mailbox_id,address,at,1 FROM visible_sent_recipients WHERE id=NEW.id GROUP BY mailbox_id,address ON CONFLICT(mailbox_id,address) DO UPDATE SET last_seen=max(last_seen,excluded.last_seen),sent_count=sent_count+1;
END;
CREATE TRIGGER snapshot_contacts_insert AFTER INSERT ON contacts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'contacts',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='contacts' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_contacts_delete AFTER DELETE ON contacts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'contacts',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'address',OLD.address,'name',OLD.name,'last_seen',OLD.last_seen,'sent_count',OLD.sent_count) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='contacts' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_contacts_update AFTER UPDATE ON contacts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'contacts',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'address',OLD.address,'name',OLD.name,'last_seen',OLD.last_seen,'sent_count',OLD.sent_count) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='contacts' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_compose_templates_insert AFTER INSERT ON compose_templates
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'compose_templates',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='compose_templates' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_compose_templates_delete AFTER DELETE ON compose_templates
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'compose_templates',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'actor',OLD.actor,'name',OLD.name,'subject',OLD.subject,'body',OLD.body,'rich',OLD.rich) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='compose_templates' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_compose_templates_update AFTER UPDATE ON compose_templates
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'compose_templates',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'actor',OLD.actor,'name',OLD.name,'subject',OLD.subject,'body',OLD.body,'rich',OLD.rich) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='compose_templates' AND seq=OLD.rowid);
END;
