-- Short-lived attachment transfers are intentionally excluded from logical backup.
CREATE TABLE agent_uploads (
 id TEXT PRIMARY KEY, ticket_hash TEXT UNIQUE NOT NULL, grant_id TEXT NOT NULL REFERENCES agent_grants,
 actor TEXT NOT NULL REFERENCES users, mailbox_id TEXT NOT NULL REFERENCES mailboxes,
 name TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, audience TEXT NOT NULL,
 put_until INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX agent_upload_expiry ON agent_uploads(expires);
CREATE INDEX agent_upload_actor ON agent_uploads(actor,expires);
