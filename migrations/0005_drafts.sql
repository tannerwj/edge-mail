CREATE TABLE drafts (
  id TEXT PRIMARY KEY,mailbox_id TEXT NOT NULL REFERENCES mailboxes,actor TEXT NOT NULL REFERENCES users,
  content TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,parent TEXT,
  FOREIGN KEY(mailbox_id,parent) REFERENCES messages(mailbox_id,id)
);
CREATE INDEX author_drafts ON drafts(actor,mailbox_id,updated_at DESC,id DESC);
CREATE TABLE reply_headers(message_id TEXT PRIMARY KEY REFERENCES messages(id),reply_to TEXT NOT NULL,reference_ids TEXT NOT NULL);
