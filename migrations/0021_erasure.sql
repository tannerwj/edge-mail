-- Authoritative erasure receipts live in R2. D1 holds the resumable cleanup work.
CREATE TABLE erasures(box TEXT NOT NULL,id TEXT NOT NULL,hash TEXT NOT NULL,at INTEGER NOT NULL,hidden INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(box,id),UNIQUE(box,hash));
CREATE TABLE erased_objects(key TEXT PRIMARY KEY,box TEXT NOT NULL,id TEXT NOT NULL,prefix INTEGER NOT NULL,done INTEGER NOT NULL DEFAULT 0,due INTEGER NOT NULL DEFAULT 0);
CREATE INDEX erase_due ON erased_objects(done,due);
CREATE INDEX erased_message_keys ON erased_objects(box,id);
CREATE TABLE erase_scan(id INTEGER PRIMARY KEY CHECK(id=1),cursor TEXT);
INSERT INTO erase_scan VALUES(1,NULL);
CREATE TABLE trash_retention(message_id TEXT PRIMARY KEY,box TEXT NOT NULL,since INTEGER NOT NULL);
CREATE INDEX trash_due ON trash_retention(since);
INSERT INTO trash_retention SELECT id,mailbox_id,unixepoch()*1000 FROM messages WHERE folder IN ('trash','spam');
CREATE TRIGGER trash_move AFTER UPDATE OF folder ON messages WHEN NEW.folder!=OLD.folder BEGIN
 DELETE FROM trash_retention WHERE message_id=NEW.id;
 INSERT INTO trash_retention SELECT NEW.id,NEW.mailbox_id,unixepoch()*1000 WHERE NEW.folder IN ('trash','spam');
END;
CREATE TRIGGER trash_create AFTER INSERT ON messages WHEN NEW.folder IN ('trash','spam') BEGIN
 INSERT OR IGNORE INTO trash_retention VALUES(NEW.id,NEW.mailbox_id,unixepoch()*1000);
END;
CREATE TRIGGER trash_remove AFTER DELETE ON messages BEGIN DELETE FROM trash_retention WHERE message_id=OLD.id; END;
