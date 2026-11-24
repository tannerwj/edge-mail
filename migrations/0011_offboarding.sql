CREATE TABLE offboard_receipts (
 id TEXT PRIMARY KEY, target TEXT NOT NULL UNIQUE REFERENCES users, actor TEXT NOT NULL REFERENCES users,
 at TEXT NOT NULL, transferred INTEGER NOT NULL, cancelled INTEGER NOT NULL, socket_cursor TEXT
);
-- Creation of a receipt and the entire access change share a single SQLite statement.
CREATE TRIGGER offboard_user AFTER INSERT ON offboard_receipts
WHEN (SELECT disabled_at IS NULL FROM users WHERE id=NEW.target)
BEGIN
  INSERT INTO mailbox_members(mailbox_id,user_id,role)
    SELECT m.mailbox_id,NEW.actor,'owner' FROM mailbox_members m
    WHERE m.user_id=NEW.target AND m.role='owner' AND NOT EXISTS (
      SELECT 1 FROM mailbox_members o JOIN users u ON u.id=o.user_id
      WHERE o.mailbox_id=m.mailbox_id AND o.user_id!=NEW.target AND o.role='owner' AND u.disabled_at IS NULL)
    ON CONFLICT(mailbox_id,user_id) DO UPDATE SET role='owner';
  UPDATE outbox SET state='cancelled',error_code='user_disabled',reserved_day=NULL
    WHERE actor=NEW.target AND state IN ('held','deferred');
  DELETE FROM mailbox_members WHERE user_id=NEW.target;
  DELETE FROM domain_admins WHERE user_id=NEW.target;
  UPDATE users SET disabled_at=NEW.at WHERE id=NEW.target;
END;
CREATE TRIGGER snapshot_offboard_receipts_insert AFTER INSERT ON offboard_receipts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'offboard_receipts',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='offboard_receipts' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_offboard_receipts_update AFTER UPDATE ON offboard_receipts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'offboard_receipts',OLD.rowid,json_object('id',OLD.id,'target',OLD.target,'actor',OLD.actor,'at',OLD.at,'transferred',OLD.transferred,'cancelled',OLD.cancelled,'socket_cursor',OLD.socket_cursor) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='offboard_receipts' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_offboard_receipts_delete AFTER DELETE ON offboard_receipts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'offboard_receipts',OLD.rowid,json_object('id',OLD.id,'target',OLD.target,'actor',OLD.actor,'at',OLD.at,'transferred',OLD.transferred,'cancelled',OLD.cancelled,'socket_cursor',OLD.socket_cursor) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='offboard_receipts' AND seq=OLD.rowid);
END;
