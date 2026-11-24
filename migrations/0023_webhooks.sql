CREATE TABLE webhooks(
 id TEXT PRIMARY KEY,mailbox_id TEXT NOT NULL REFERENCES mailboxes,actor TEXT NOT NULL REFERENCES users,grant_id TEXT REFERENCES agent_grants,
 host TEXT NOT NULL,endpoint TEXT NOT NULL,events TEXT NOT NULL,version INTEGER NOT NULL,keydata TEXT NOT NULL,previous_key TEXT,previous_until INTEGER,
 enabled INTEGER NOT NULL DEFAULT 1,updated INTEGER NOT NULL,audit_id TEXT
);
CREATE INDEX hooks_by_mailbox ON webhooks(mailbox_id,enabled);
CREATE TABLE webhook_jobs(
 id TEXT PRIMARY KEY,hook TEXT NOT NULL REFERENCES webhooks,kind TEXT NOT NULL,resource TEXT NOT NULL,event_key TEXT NOT NULL,detail TEXT,
 created INTEGER NOT NULL,due INTEGER NOT NULL,tries INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'pending',version INTEGER NOT NULL,
 UNIQUE(hook,kind,event_key)
);
CREATE INDEX hook_jobs_due ON webhook_jobs(state,due);
CREATE INDEX hook_jobs_resource ON webhook_jobs(resource);
CREATE TRIGGER hook_disable AFTER UPDATE OF enabled ON webhooks WHEN NEW.enabled=0 BEGIN
 UPDATE webhook_jobs SET state='cancelled' WHERE hook=NEW.id AND state='pending';
END;
CREATE TRIGGER hook_offboard AFTER UPDATE OF disabled_at ON users WHEN NEW.disabled_at IS NOT NULL BEGIN
 UPDATE webhooks SET enabled=0 WHERE actor=NEW.id;
END;
CREATE TRIGGER hook_erasure AFTER DELETE ON messages BEGIN DELETE FROM webhook_jobs WHERE resource=OLD.id; END;
CREATE TRIGGER hook_receive AFTER INSERT ON deliveries WHEN NEW.kind!='import' BEGIN
 INSERT OR IGNORE INTO webhook_jobs(id,hook,kind,resource,event_key,detail,created,due,version)
 SELECT lower(hex(randomblob(16))),w.id,'message.received',NEW.message_id,NEW.message_id,NULL,unixepoch()*1000,unixepoch()*1000,w.version
 FROM webhooks w  WHERE w.enabled=1 AND w.mailbox_id=NEW.mailbox_id AND EXISTS(SELECT 1 FROM json_each(w.events) WHERE value='message.received');
END;
CREATE TRIGGER hook_sent AFTER INSERT ON messages WHEN NEW.content_hash='sent-'||NEW.id BEGIN
 INSERT OR IGNORE INTO webhook_jobs(id,hook,kind,resource,event_key,detail,created,due,version)
 SELECT lower(hex(randomblob(16))),w.id,'message.sent',NEW.id,NEW.id,NULL,unixepoch()*1000,unixepoch()*1000,w.version
 FROM webhooks w  WHERE w.enabled=1 AND w.mailbox_id=NEW.mailbox_id AND EXISTS(SELECT 1 FROM json_each(w.events) WHERE value='message.sent');
END;
CREATE TRIGGER hook_matched AFTER INSERT ON rule_runs WHEN 1 BEGIN
 INSERT OR IGNORE INTO webhook_jobs(id,hook,kind,resource,event_key,detail,created,due,version)
 SELECT lower(hex(randomblob(16))),w.id,'rule.matched',NEW.message_id,NEW.execution_id||NEW.rule_id,NEW.rule_id,unixepoch()*1000,unixepoch()*1000,w.version
 FROM webhooks w  WHERE w.enabled=1 AND w.mailbox_id=NEW.mailbox_id AND EXISTS(SELECT 1 FROM json_each(w.events) WHERE value='rule.matched');
END;
CREATE TRIGGER hook_delivery AFTER INSERT ON delivery_events WHEN NEW.kind IN ('delivered','bounced','complained') BEGIN
 INSERT OR IGNORE INTO webhook_jobs(id,hook,kind,resource,event_key,detail,created,due,version)
 SELECT lower(hex(randomblob(16))),w.id,'message.delivery',o.id,NEW.event_id,NEW.kind,unixepoch()*1000,unixepoch()*1000,w.version
 FROM webhooks w JOIN outbox o ON o.provider=NEW.provider AND trim(o.provider_id,'<>')=NEW.provider_id AND substr(o.from_addr,instr(o.from_addr,'@')+1)=NEW.domain WHERE w.enabled=1 AND w.mailbox_id=o.mailbox_id AND EXISTS(SELECT 1 FROM json_each(w.events) WHERE value='message.delivery');
END;
CREATE TRIGGER hook_early_delivery AFTER UPDATE OF provider_id ON outbox WHEN NEW.provider_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO webhook_jobs(id,hook,kind,resource,event_key,detail,created,due,version)
 SELECT lower(hex(randomblob(16))),w.id,'message.delivery',NEW.id,e.event_id,e.kind,unixepoch()*1000,unixepoch()*1000,w.version FROM delivery_events e JOIN webhooks w ON w.mailbox_id=NEW.mailbox_id AND w.enabled=1
 WHERE e.provider=NEW.provider AND e.provider_id=trim(NEW.provider_id,'<>') AND e.domain=substr(NEW.from_addr,instr(NEW.from_addr,'@')+1) AND e.kind IN ('delivered','bounced','complained') AND EXISTS(SELECT 1 FROM json_each(w.events) WHERE value='message.delivery');
END;
CREATE TRIGGER snapshot_webhooks_insert AFTER INSERT ON webhooks
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'webhooks',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='webhooks' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_webhooks_update AFTER UPDATE ON webhooks
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'webhooks',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'actor',OLD.actor,'grant_id',OLD.grant_id,'host',OLD.host,'endpoint',OLD.endpoint,'events',OLD.events,'version',OLD.version,'keydata',OLD.keydata,'previous_key',OLD.previous_key,'previous_until',OLD.previous_until,'enabled',OLD.enabled,'updated',OLD.updated,'audit_id',OLD.audit_id) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='webhooks' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_webhooks_delete AFTER DELETE ON webhooks
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'webhooks',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'actor',OLD.actor,'grant_id',OLD.grant_id,'host',OLD.host,'endpoint',OLD.endpoint,'events',OLD.events,'version',OLD.version,'keydata',OLD.keydata,'previous_key',OLD.previous_key,'previous_until',OLD.previous_until,'enabled',OLD.enabled,'updated',OLD.updated,'audit_id',OLD.audit_id) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='webhooks' AND seq=OLD.rowid);
END;
