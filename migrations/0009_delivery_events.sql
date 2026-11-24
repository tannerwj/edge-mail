CREATE TABLE delivery_events (
 event_id TEXT PRIMARY KEY, provider TEXT NOT NULL, domain TEXT NOT NULL, provider_id TEXT NOT NULL,
 recipient TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, smtp_code TEXT
);
CREATE INDEX delivery_event_message ON delivery_events(provider,domain,provider_id,recipient,at DESC);
CREATE INDEX delivery_event_complaint ON delivery_events(kind,at DESC);
CREATE TRIGGER snapshot_delivery_events_insert AFTER INSERT ON delivery_events
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'delivery_events',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='delivery_events' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_delivery_events_update AFTER UPDATE ON delivery_events
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'delivery_events',OLD.rowid,json_object('event_id',OLD.event_id,'provider',OLD.provider,'domain',OLD.domain,'provider_id',OLD.provider_id,'recipient',OLD.recipient,'kind',OLD.kind,'at',OLD.at,'smtp_code',OLD.smtp_code) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='delivery_events' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_delivery_events_delete AFTER DELETE ON delivery_events
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'delivery_events',OLD.rowid,json_object('event_id',OLD.event_id,'provider',OLD.provider,'domain',OLD.domain,'provider_id',OLD.provider_id,'recipient',OLD.recipient,'kind',OLD.kind,'at',OLD.at,'smtp_code',OLD.smtp_code) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='delivery_events' AND seq=OLD.rowid);
END;
