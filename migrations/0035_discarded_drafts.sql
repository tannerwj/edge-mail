ALTER TABLE drafts ADD COLUMN discarded_until INTEGER;
CREATE INDEX draft_discard_expiry ON drafts(discarded_until) WHERE discarded_until IS NOT NULL;
DROP TRIGGER snapshot_drafts_update;
CREATE TRIGGER snapshot_drafts_update AFTER UPDATE ON drafts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'drafts',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'actor',OLD.actor,'content',OLD.content,'revision',OLD.revision,'updated_at',OLD.updated_at,'parent',OLD.parent,'discarded_until',OLD.discarded_until) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='drafts' AND seq=OLD.rowid);
END;
DROP TRIGGER snapshot_drafts_delete;
CREATE TRIGGER snapshot_drafts_delete AFTER DELETE ON drafts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'drafts',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'actor',OLD.actor,'content',OLD.content,'revision',OLD.revision,'updated_at',OLD.updated_at,'parent',OLD.parent,'discarded_until',OLD.discarded_until) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='drafts' AND seq=OLD.rowid);
END;
