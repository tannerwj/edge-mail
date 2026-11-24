ALTER TABLE messages ADD COLUMN folder TEXT NOT NULL DEFAULT 'inbox' CHECK(folder IN ('inbox','archive','spam','trash','sent'));
ALTER TABLE messages ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0,1));
ALTER TABLE messages ADD COLUMN starred INTEGER NOT NULL DEFAULT 0 CHECK(starred IN (0,1));
CREATE INDEX messages_folder ON messages(mailbox_id,folder,received_at DESC,id DESC);
CREATE INDEX messages_sender ON messages(mailbox_id,sender COLLATE NOCASE);
CREATE TABLE message_labels (
  mailbox_id TEXT NOT NULL, message_id TEXT NOT NULL, label TEXT COLLATE NOCASE NOT NULL,
  PRIMARY KEY(mailbox_id,message_id,label), FOREIGN KEY(mailbox_id,message_id) REFERENCES messages(mailbox_id,id)
);
CREATE INDEX labels_by_name ON message_labels(mailbox_id,label,message_id);
CREATE TABLE message_metadata (
  message_id TEXT PRIMARY KEY REFERENCES messages(id), raw_bytes INTEGER NOT NULL, recipients TEXT NOT NULL, cc TEXT NOT NULL
);
