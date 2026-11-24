CREATE TABLE outbox (
 id TEXT PRIMARY KEY,mailbox_id TEXT NOT NULL REFERENCES mailboxes,actor TEXT NOT NULL REFERENCES users,
 provider TEXT NOT NULL,from_addr TEXT NOT NULL,reply_addr TEXT NOT NULL,letter TEXT NOT NULL,parent TEXT,
 units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 50),state TEXT NOT NULL CHECK(state IN ('held','claimed','sent','failed','deferred','uncertain','cancelled')),
 due_ms INTEGER NOT NULL,claimed_ms INTEGER,attempts INTEGER NOT NULL DEFAULT 0,reserved_day TEXT,
 error_code TEXT,provider_id TEXT,created_at TEXT NOT NULL,FOREIGN KEY(mailbox_id,parent) REFERENCES messages(mailbox_id,id)
);
CREATE INDEX outbox_due ON outbox(state,due_ms);
CREATE INDEX outbox_budget ON outbox(reserved_day,actor);
CREATE INDEX outbox_author ON outbox(actor,mailbox_id,created_at DESC);
CREATE TABLE outbox_control(id INTEGER PRIMARY KEY CHECK(id=1),paused INTEGER NOT NULL DEFAULT 0);
INSERT INTO outbox_control(id) VALUES(1);
