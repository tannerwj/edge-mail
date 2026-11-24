CREATE TABLE instance_policy(id INTEGER PRIMARY KEY CHECK(id=1),monthly_cap INTEGER,agent_writes INTEGER NOT NULL DEFAULT 1);
INSERT INTO instance_policy VALUES(1,NULL,1);
CREATE TABLE user_limits(actor TEXT PRIMARY KEY REFERENCES users,daily_cap INTEGER NOT NULL);
CREATE TABLE send_reservations(item TEXT PRIMARY KEY,actor TEXT NOT NULL,day TEXT NOT NULL,units INTEGER NOT NULL);
CREATE INDEX reserve_day ON send_reservations(day,actor);
INSERT INTO send_reservations SELECT id,actor,reserved_day,units FROM outbox WHERE reserved_day IS NOT NULL;
CREATE TRIGGER send_reserve AFTER UPDATE OF state ON outbox WHEN NEW.state='claimed' BEGIN
 INSERT INTO send_reservations VALUES(NEW.id,NEW.actor,coalesce(NEW.reserved_day,date(NEW.claimed_ms/1000,'unixepoch'),date('now')),NEW.units) ON CONFLICT(item) DO UPDATE SET day=excluded.day,units=excluded.units;
END;
CREATE TRIGGER send_release AFTER UPDATE OF state ON outbox WHEN OLD.state='claimed' AND NEW.state IN('deferred','failed','cancelled') AND NEW.reserved_day IS NULL BEGIN
 DELETE FROM send_reservations WHERE item=NEW.id;
 DELETE FROM grant_spend WHERE item=NEW.id AND day=OLD.reserved_day;
END;
CREATE TABLE ops_alerts(id TEXT PRIMARY KEY,code TEXT NOT NULL,created INTEGER NOT NULL,last_seen INTEGER NOT NULL,resolved INTEGER);
CREATE TRIGGER ops_alert_push AFTER INSERT ON ops_alerts BEGIN
 INSERT OR IGNORE INTO push_jobs(event,device,mailbox_id,topic,due) SELECT NEW.id,d.id,(SELECT min(id) FROM mailboxes),'operations',NEW.created FROM push_devices d JOIN users u ON u.id=d.actor WHERE u.role='owner' AND u.disabled_at IS NULL AND EXISTS(SELECT 1 FROM mailboxes);
END;
CREATE TRIGGER complaint_alert AFTER INSERT ON delivery_events WHEN NEW.kind='complained' BEGIN
 INSERT OR IGNORE INTO ops_alerts VALUES('complaint-'||NEW.event_id,'complaint',unixepoch()*1000,unixepoch()*1000,NULL);
END;
CREATE TRIGGER submission_alert AFTER UPDATE OF state ON outbox WHEN NEW.state='uncertain' AND OLD.state!='uncertain' BEGIN
 INSERT OR IGNORE INTO ops_alerts VALUES('uncertain-'||NEW.id,'uncertain',unixepoch()*1000,unixepoch()*1000,NULL);
END;
CREATE TRIGGER suspension_alert AFTER UPDATE OF paused ON outbox_control WHEN NEW.paused=1 AND OLD.paused=0 BEGIN
 INSERT OR IGNORE INTO ops_alerts VALUES('paused-'||unixepoch(),'sending_paused',unixepoch()*1000,unixepoch()*1000,NULL);
END;
CREATE TRIGGER snapshot_instance_policy_insert AFTER INSERT ON instance_policy
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'instance_policy',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='instance_policy' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_instance_policy_delete AFTER DELETE ON instance_policy
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'instance_policy',OLD.rowid,json_object('id',OLD.id,'monthly_cap',OLD.monthly_cap,'agent_writes',OLD.agent_writes) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='instance_policy' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_instance_policy_update AFTER UPDATE ON instance_policy
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'instance_policy',OLD.rowid,json_object('id',OLD.id,'monthly_cap',OLD.monthly_cap,'agent_writes',OLD.agent_writes) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='instance_policy' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_user_limits_insert AFTER INSERT ON user_limits
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'user_limits',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='user_limits' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_user_limits_delete AFTER DELETE ON user_limits
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'user_limits',OLD.rowid,json_object('actor',OLD.actor,'daily_cap',OLD.daily_cap) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='user_limits' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_user_limits_update AFTER UPDATE ON user_limits
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'user_limits',OLD.rowid,json_object('actor',OLD.actor,'daily_cap',OLD.daily_cap) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='user_limits' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_send_reservations_insert AFTER INSERT ON send_reservations
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'send_reservations',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='send_reservations' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_send_reservations_delete AFTER DELETE ON send_reservations
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'send_reservations',OLD.rowid,json_object('item',OLD.item,'actor',OLD.actor,'day',OLD.day,'units',OLD.units) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='send_reservations' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_send_reservations_update AFTER UPDATE ON send_reservations
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'send_reservations',OLD.rowid,json_object('item',OLD.item,'actor',OLD.actor,'day',OLD.day,'units',OLD.units) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='send_reservations' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_ops_alerts_insert AFTER INSERT ON ops_alerts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'ops_alerts',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='ops_alerts' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_ops_alerts_delete AFTER DELETE ON ops_alerts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'ops_alerts',OLD.rowid,json_object('id',OLD.id,'code',OLD.code,'created',OLD.created,'last_seen',OLD.last_seen,'resolved',OLD.resolved) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='ops_alerts' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_ops_alerts_update AFTER UPDATE ON ops_alerts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'ops_alerts',OLD.rowid,json_object('id',OLD.id,'code',OLD.code,'created',OLD.created,'last_seen',OLD.last_seen,'resolved',OLD.resolved) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='ops_alerts' AND seq=OLD.rowid);
END;

CREATE TABLE account_usage(id INTEGER PRIMARY KEY CHECK(id=1),month TEXT NOT NULL,checked INTEGER NOT NULL,operations INTEGER);
