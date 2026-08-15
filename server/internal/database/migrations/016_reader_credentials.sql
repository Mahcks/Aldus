CREATE TABLE reader_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    sync_key_hash TEXT NOT NULL,
    last_used_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX reader_credentials_user ON reader_credentials(user_id, created_at DESC);
