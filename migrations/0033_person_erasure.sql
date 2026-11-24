-- Recovery reconstructs these work tables from immutable R2 receipts.
CREATE TABLE person_erasures(target TEXT PRIMARY KEY,actor TEXT NOT NULL,at INTEGER NOT NULL,boxes TEXT NOT NULL,journaled INTEGER NOT NULL DEFAULT 0,prepared INTEGER NOT NULL DEFAULT 0,finished INTEGER NOT NULL DEFAULT 0);
CREATE TABLE person_boxes(box TEXT PRIMARY KEY,target TEXT NOT NULL,closed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX person_box_target ON person_boxes(target,closed);
CREATE TRIGGER register_person_boxes AFTER INSERT ON person_erasures BEGIN
 INSERT OR IGNORE INTO person_boxes(box,target) SELECT value,NEW.target FROM json_each(NEW.boxes);
END;
CREATE TRIGGER prevent_erased_members BEFORE INSERT ON mailbox_members WHEN EXISTS(SELECT 1 FROM person_boxes WHERE box=NEW.mailbox_id) BEGIN SELECT RAISE(ABORT,'Mailbox pending erasure'); END;
CREATE TRIGGER prevent_erased_delivery BEFORE INSERT ON messages WHEN EXISTS(SELECT 1 FROM person_boxes WHERE box=NEW.mailbox_id) BEGIN SELECT RAISE(ABORT,'Mailbox pending erasure'); END;
CREATE TABLE person_cleanup(target TEXT NOT NULL,path TEXT PRIMARY KEY,prefix INTEGER NOT NULL,cursor TEXT,due INTEGER NOT NULL DEFAULT 0);
