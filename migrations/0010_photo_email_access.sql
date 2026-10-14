CREATE TABLE photo_access_approvals (
  id TEXT PRIMARY KEY,
  email_hash TEXT UNIQUE,
  email TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE photo_login_challenges (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL UNIQUE,
  approval_id TEXT NOT NULL REFERENCES photo_access_approvals(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0 CHECK (delivered IN (0, 1)),
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  session_hash TEXT
);
CREATE INDEX photo_login_expiry ON photo_login_challenges(expires_at);

CREATE TABLE photo_access_sessions (
  token_hash TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL REFERENCES photo_access_approvals(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX photo_sessions_expiry ON photo_access_sessions(expires_at);
CREATE INDEX photo_sessions_approval ON photo_access_sessions(approval_id);

CREATE TABLE photo_login_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX photo_limits_expiry ON photo_login_limits(expires_at);
