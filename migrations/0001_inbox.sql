CREATE TABLE users (
  id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
  disabled_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE user_emails (email TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users);
CREATE TABLE domains (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users);
CREATE TABLE domain_admins (
  domain_id TEXT NOT NULL REFERENCES domains, user_id TEXT NOT NULL REFERENCES users,
  PRIMARY KEY(domain_id,user_id)
);
CREATE TABLE mailboxes (
  id TEXT PRIMARY KEY, domain_id TEXT NOT NULL REFERENCES domains, address TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users
);
CREATE TABLE mailbox_members (
  mailbox_id TEXT NOT NULL REFERENCES mailboxes, user_id TEXT NOT NULL REFERENCES users,
  role TEXT NOT NULL CHECK(role IN ('owner','editor','reader')), PRIMARY KEY(mailbox_id,user_id)
);
CREATE TABLE addresses (
  canonical TEXT PRIMARY KEY, address TEXT NOT NULL, mailbox_id TEXT NOT NULL REFERENCES mailboxes,
  kind TEXT NOT NULL CHECK(kind IN ('primary','alias'))
);
CREATE INDEX addresses_mailbox ON addresses(mailbox_id);
CREATE TABLE messages (
  rowid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, mailbox_id TEXT NOT NULL REFERENCES mailboxes,
  content_hash TEXT NOT NULL, wire_id TEXT NOT NULL, synthetic INTEGER NOT NULL,
  sender TEXT NOT NULL, subject TEXT NOT NULL, snippet TEXT NOT NULL, body_key TEXT NOT NULL,
  received_at TEXT NOT NULL, attachment_count INTEGER NOT NULL, UNIQUE(mailbox_id,content_hash), UNIQUE(mailbox_id,id)
);
CREATE INDEX messages_inbox ON messages(mailbox_id,received_at DESC,id DESC);
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY, mailbox_id TEXT NOT NULL, message_id TEXT NOT NULL, raw_key TEXT NOT NULL UNIQUE,
  envelope_from TEXT NOT NULL, envelope_to TEXT NOT NULL, matched_address TEXT NOT NULL, kind TEXT NOT NULL,
  plus_tag TEXT, received_at TEXT NOT NULL, auth TEXT NOT NULL,
  FOREIGN KEY(mailbox_id,message_id) REFERENCES messages(mailbox_id,id)
);
CREATE INDEX deliveries_message ON deliveries(mailbox_id,message_id);
CREATE VIRTUAL TABLE search_fts USING fts5(subject,body_text,content='');
CREATE TABLE ingest_failures (
  raw_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, last_at TEXT NOT NULL
);
CREATE TABLE reconciliation (id INTEGER PRIMARY KEY CHECK(id=1), cursor TEXT);
INSERT INTO reconciliation VALUES (1,NULL);
