CREATE TABLE grant_policies(grant_id TEXT PRIMARY KEY REFERENCES agent_grants,send_mode TEXT NOT NULL,daily_cap INTEGER,recipients TEXT,review_egress INTEGER NOT NULL);
CREATE TABLE grant_spend(grant_id TEXT NOT NULL REFERENCES agent_grants,day TEXT NOT NULL,item TEXT NOT NULL,units INTEGER NOT NULL,PRIMARY KEY(grant_id,day,item));
CREATE TABLE agent_reviews(id TEXT PRIMARY KEY,mailbox_id TEXT NOT NULL REFERENCES mailboxes,grant_id TEXT NOT NULL REFERENCES agent_grants,actor TEXT NOT NULL REFERENCES users,kind TEXT NOT NULL,reason TEXT NOT NULL,request TEXT,state TEXT NOT NULL DEFAULT 'pending',decided_by TEXT REFERENCES users,created INTEGER NOT NULL,decided INTEGER,request_key TEXT UNIQUE);
CREATE INDEX review_mailbox ON agent_reviews(mailbox_id,state,created);
CREATE VIEW grant_lineage AS WITH RECURSIVE family(leaf,ancestor,depth) AS (SELECT id,id,1 FROM agent_grants UNION ALL SELECT f.leaf,g.parent,f.depth+1 FROM family f JOIN agent_grants g ON g.id=f.ancestor WHERE g.parent IS NOT NULL AND f.depth<8) SELECT leaf,ancestor FROM family;
CREATE VIEW human_recipients AS SELECT o.mailbox_id,r.value AS address FROM outbox o,json_each(json_array(json_extract(o.letter,'$.to'),json_extract(o.letter,'$.cc'),json_extract(o.letter,'$.bcc'))) buckets JOIN json_each(buckets.value) r WHERE o.state='sent' AND json_extract(o.letter,'$.agent_grant') IS NULL AND json_extract(o.letter,'$.vacation') IS NULL AND json_extract(o.letter,'$.forwardedFrom') IS NULL;
CREATE TRIGGER grant_charge AFTER UPDATE OF state ON outbox WHEN NEW.state='claimed' AND json_extract(NEW.letter,'$.agent_grant') IS NOT NULL BEGIN
 INSERT OR IGNORE INTO grant_spend SELECT l.ancestor,NEW.reserved_day,NEW.id,NEW.units FROM grant_lineage l JOIN grant_policies p ON p.grant_id=l.ancestor WHERE l.leaf=json_extract(NEW.letter,'$.agent_grant') AND p.daily_cap IS NOT NULL;
END;
CREATE TRIGGER review_notice AFTER INSERT ON agent_reviews WHEN NEW.state='pending' BEGIN
 INSERT OR IGNORE INTO push_jobs(event,device,mailbox_id,topic,due) SELECT NEW.id,d.id,NEW.mailbox_id,'approval',NEW.created FROM push_devices d WHERE d.actor=NEW.actor;
 INSERT OR IGNORE INTO webhook_jobs(id,hook,kind,resource,event_key,detail,created,due,version) SELECT lower(hex(randomblob(16))),w.id,'approval.requested',NEW.id,NEW.id,NULL,NEW.created,NEW.created,w.version FROM webhooks w WHERE w.enabled=1 AND w.mailbox_id=NEW.mailbox_id AND EXISTS(SELECT 1 FROM json_each(w.events) WHERE value='approval.requested');
END;
CREATE TRIGGER review_cancel AFTER UPDATE OF state ON outbox WHEN NEW.state IN('failed','cancelled') BEGIN
 UPDATE agent_reviews SET state='cancelled',decided=unixepoch()*1000 WHERE id=NEW.id AND state='pending';
END;
CREATE TRIGGER review_revoke AFTER UPDATE OF revoked ON agent_grants WHEN NEW.revoked IS NOT NULL BEGIN
 UPDATE agent_reviews SET state='cancelled',decided=unixepoch()*1000 WHERE grant_id IN(SELECT leaf FROM grant_lineage WHERE ancestor=NEW.id) AND state='pending';
END;
CREATE TRIGGER snapshot_grant_policies_insert AFTER INSERT ON grant_policies
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'grant_policies',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='grant_policies' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_grant_policies_update AFTER UPDATE ON grant_policies
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'grant_policies',OLD.rowid,json_object('grant_id',OLD.grant_id,'send_mode',OLD.send_mode,'daily_cap',OLD.daily_cap,'recipients',OLD.recipients,'review_egress',OLD.review_egress) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='grant_policies' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_grant_policies_delete AFTER DELETE ON grant_policies
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'grant_policies',OLD.rowid,json_object('grant_id',OLD.grant_id,'send_mode',OLD.send_mode,'daily_cap',OLD.daily_cap,'recipients',OLD.recipients,'review_egress',OLD.review_egress) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='grant_policies' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_grant_spend_insert AFTER INSERT ON grant_spend
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'grant_spend',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='grant_spend' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_grant_spend_update AFTER UPDATE ON grant_spend
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'grant_spend',OLD.rowid,json_object('grant_id',OLD.grant_id,'day',OLD.day,'item',OLD.item,'units',OLD.units) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='grant_spend' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_grant_spend_delete AFTER DELETE ON grant_spend
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'grant_spend',OLD.rowid,json_object('grant_id',OLD.grant_id,'day',OLD.day,'item',OLD.item,'units',OLD.units) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='grant_spend' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_agent_reviews_insert AFTER INSERT ON agent_reviews
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'agent_reviews',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='agent_reviews' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_agent_reviews_update AFTER UPDATE ON agent_reviews
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'agent_reviews',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'grant_id',OLD.grant_id,'actor',OLD.actor,'kind',OLD.kind,'reason',OLD.reason,'request',OLD.request,'state',OLD.state,'decided_by',OLD.decided_by,'created',OLD.created,'decided',OLD.decided,'request_key',OLD.request_key) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='agent_reviews' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_agent_reviews_delete AFTER DELETE ON agent_reviews
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'agent_reviews',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'grant_id',OLD.grant_id,'actor',OLD.actor,'kind',OLD.kind,'reason',OLD.reason,'request',OLD.request,'state',OLD.state,'decided_by',OLD.decided_by,'created',OLD.created,'decided',OLD.decided,'request_key',OLD.request_key) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='agent_reviews' AND seq=OLD.rowid);
END;
CREATE VIEW outgoing_recipients AS SELECT o.id,r.value AS address FROM outbox o,json_each(json_array(json_extract(o.letter,'$.to'),json_extract(o.letter,'$.cc'),json_extract(o.letter,'$.bcc'))) buckets JOIN json_each(buckets.value) r;
CREATE TRIGGER review_agent_send AFTER INSERT ON outbox WHEN json_extract(NEW.letter,'$.agent_grant') IS NOT NULL AND NEW.state='held' BEGIN
 UPDATE outbox SET state='failed',error_code='grant_send_policy' WHERE id=NEW.id AND EXISTS(SELECT 1 FROM grant_lineage l JOIN grant_policies p ON p.grant_id=l.ancestor WHERE l.leaf=json_extract(NEW.letter,'$.agent_grant') AND (p.send_mode='drafts_only' OR (p.recipients IS NOT NULL AND EXISTS(SELECT 1 FROM outgoing_recipients r WHERE r.id=NEW.id AND r.address NOT IN(SELECT value FROM json_each(p.recipients))))));
 INSERT OR IGNORE INTO agent_reviews(id,mailbox_id,grant_id,actor,kind,reason,created)
 SELECT NEW.id,NEW.mailbox_id,json_extract(NEW.letter,'$.agent_grant'),NEW.actor,'send','human_approval',unixepoch()*1000 WHERE EXISTS(SELECT 1 FROM outbox WHERE id=NEW.id AND state='held') AND EXISTS(SELECT 1 FROM grant_lineage l JOIN grant_policies p ON p.grant_id=l.ancestor WHERE l.leaf=json_extract(NEW.letter,'$.agent_grant') AND (p.send_mode='hold_all' OR (p.send_mode='hold_new_recipients' AND EXISTS(SELECT 1 FROM outgoing_recipients r WHERE r.id=NEW.id AND NOT EXISTS(SELECT 1 FROM human_recipients h WHERE h.mailbox_id=NEW.mailbox_id AND h.address=r.address)))));
END;
