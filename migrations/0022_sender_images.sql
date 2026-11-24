CREATE TABLE sender_images (
 mailbox_id TEXT NOT NULL REFERENCES mailboxes,address TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users,PRIMARY KEY(mailbox_id,address,user_id)
);
CREATE TRIGGER snapshot_sender_images_insert AFTER INSERT ON sender_images
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'sender_images',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='sender_images' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_sender_images_update AFTER UPDATE ON sender_images
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'sender_images',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'address',OLD.address,'user_id',OLD.user_id) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='sender_images' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_sender_images_delete AFTER DELETE ON sender_images
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows')) BEGIN
 INSERT INTO snapshot_original SELECT 'sender_images',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'address',OLD.address,'user_id',OLD.user_id) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='sender_images' AND seq=OLD.rowid);
END;
