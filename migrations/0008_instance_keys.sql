CREATE TABLE instance_keys(name TEXT PRIMARY KEY,ciphertext TEXT NOT NULL,iv TEXT NOT NULL);
ALTER TABLE snapshot_runs ADD COLUMN schema_version TEXT NOT NULL DEFAULT '0007_snapshots.sql';
CREATE TRIGGER snapshot_instance_keys_insert AFTER INSERT ON instance_keys
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'instance_keys',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='instance_keys' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_instance_keys_update AFTER UPDATE ON instance_keys
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'instance_keys',OLD.rowid,json_object('name',OLD.name,'ciphertext',OLD.ciphertext,'iv',OLD.iv) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='instance_keys' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_instance_keys_delete AFTER DELETE ON instance_keys
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'instance_keys',OLD.rowid,json_object('name',OLD.name,'ciphertext',OLD.ciphertext,'iv',OLD.iv) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='instance_keys' AND seq=OLD.rowid);
END;
