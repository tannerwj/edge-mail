CREATE TABLE push_devices(
 id TEXT PRIMARY KEY,actor TEXT NOT NULL REFERENCES users,ciphertext TEXT NOT NULL,iv TEXT NOT NULL,
 site TEXT NOT NULL,new_mail INTEGER NOT NULL,last_used INTEGER NOT NULL
);
CREATE INDEX push_actor ON push_devices(actor);
CREATE TABLE push_jobs(
 event TEXT NOT NULL, device TEXT NOT NULL REFERENCES push_devices ON DELETE CASCADE,
 mailbox_id TEXT NOT NULL REFERENCES mailboxes,topic TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
 due INTEGER NOT NULL,claim TEXT,PRIMARY KEY(event,device,topic)
);
CREATE INDEX push_due ON push_jobs(due);
CREATE TABLE egress_alerts(
 audit_id TEXT PRIMARY KEY REFERENCES agent_audit,mailbox_id TEXT NOT NULL REFERENCES mailboxes,
 at INTEGER NOT NULL,ack_by TEXT REFERENCES users,ack_at INTEGER
);
CREATE INDEX alerts_box ON egress_alerts(mailbox_id,ack_at,at);
CREATE TRIGGER revoke_push AFTER UPDATE OF disabled_at ON users WHEN NEW.disabled_at IS NOT NULL BEGIN
 DELETE FROM push_devices WHERE actor=NEW.id;
END;
CREATE TRIGGER alert_push AFTER INSERT ON egress_alerts BEGIN
 INSERT INTO push_jobs(event,device,mailbox_id,topic,due)
 SELECT NEW.audit_id,d.id,NEW.mailbox_id,'egress',NEW.at FROM push_devices d JOIN users u ON u.id=d.actor
 WHERE u.disabled_at IS NULL AND (u.role='owner' OR EXISTS(SELECT 1 FROM mailbox_members m WHERE m.user_id=u.id AND m.mailbox_id=NEW.mailbox_id AND m.role='owner'));
END;
CREATE TRIGGER snapshot_egress_alerts_insert AFTER INSERT ON egress_alerts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'egress_alerts',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='egress_alerts' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_egress_alerts_update AFTER UPDATE ON egress_alerts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'egress_alerts',OLD.rowid,json_object('audit_id',OLD.audit_id,'mailbox_id',OLD.mailbox_id,'at',OLD.at,'ack_by',OLD.ack_by,'ack_at',OLD.ack_at) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='egress_alerts' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_egress_alerts_delete AFTER DELETE ON egress_alerts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'egress_alerts',OLD.rowid,json_object('audit_id',OLD.audit_id,'mailbox_id',OLD.mailbox_id,'at',OLD.at,'ack_by',OLD.ack_by,'ack_at',OLD.ack_at) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='egress_alerts' AND seq=OLD.rowid);
END;
