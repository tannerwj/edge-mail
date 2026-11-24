CREATE TABLE mailbox_quotas(mailbox_id TEXT PRIMARY KEY REFERENCES mailboxes ON DELETE CASCADE,r2_soft INTEGER,r2_hard INTEGER,d1_soft INTEGER,d1_hard INTEGER,sender_rate INTEGER,recipient_rate INTEGER);
CREATE TABLE quota_usage(box TEXT PRIMARY KEY REFERENCES mailbox_quotas ON DELETE CASCADE,messages INTEGER NOT NULL,total INTEGER NOT NULL DEFAULT 0,measured INTEGER NOT NULL DEFAULT 0,started INTEGER NOT NULL DEFAULT 0,part INTEGER NOT NULL DEFAULT 0,cursor TEXT NOT NULL DEFAULT '',subtotal INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER quota_start AFTER INSERT ON mailbox_quotas BEGIN INSERT INTO quota_usage(box,messages) SELECT NEW.mailbox_id,count(*) FROM messages WHERE mailbox_id=NEW.mailbox_id; END;
CREATE TRIGGER quota_message AFTER INSERT ON messages BEGIN UPDATE quota_usage SET messages=messages+1 WHERE box=NEW.mailbox_id; END;
CREATE TRIGGER quota_remove AFTER DELETE ON messages BEGIN UPDATE quota_usage SET messages=max(0,messages-1) WHERE box=OLD.mailbox_id; END;
CREATE TABLE quota_reservations(id TEXT PRIMARY KEY,box TEXT NOT NULL REFERENCES mailbox_quotas ON DELETE CASCADE,bytes INTEGER NOT NULL,at INTEGER NOT NULL,sender TEXT NOT NULL,recipient TEXT NOT NULL,raw_key TEXT NOT NULL,indexed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX quota_box_time ON quota_reservations(box,at);
CREATE INDEX quota_sender ON quota_reservations(box,sender,at);
CREATE INDEX quota_recipient ON quota_reservations(box,recipient,at);
CREATE TRIGGER quota_index AFTER INSERT ON deliveries BEGIN UPDATE quota_reservations SET indexed=1 WHERE id=NEW.id; END;
CREATE TRIGGER snapshot_mailbox_quotas_insert AFTER INSERT ON mailbox_quotas
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'mailbox_quotas',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='mailbox_quotas' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_mailbox_quotas_update AFTER UPDATE ON mailbox_quotas
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'mailbox_quotas',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'r2_soft',OLD.r2_soft,'r2_hard',OLD.r2_hard,'d1_soft',OLD.d1_soft,'d1_hard',OLD.d1_hard,'sender_rate',OLD.sender_rate,'recipient_rate',OLD.recipient_rate) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='mailbox_quotas' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_mailbox_quotas_delete AFTER DELETE ON mailbox_quotas
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'mailbox_quotas',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'r2_soft',OLD.r2_soft,'r2_hard',OLD.r2_hard,'d1_soft',OLD.d1_soft,'d1_hard',OLD.d1_hard,'sender_rate',OLD.sender_rate,'recipient_rate',OLD.recipient_rate) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='mailbox_quotas' AND seq=OLD.rowid);
END;
