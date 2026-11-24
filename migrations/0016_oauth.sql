-- OAuth operational records are intentionally excluded from backups. Recovery revokes every app grant.
CREATE TABLE oauth_credentials(
 digest TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES agent_grants, client TEXT NOT NULL, scopes TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('access','refresh')), expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX oauth_credential_expiry ON oauth_credentials(expires);
CREATE TABLE oauth_pending(digest TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES users, expires INTEGER NOT NULL);
CREATE INDEX oauth_pending_expiry ON oauth_pending(expires);
CREATE TABLE oauth_registrations(id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE INDEX oauth_registration_expiry ON oauth_registrations(expires);
