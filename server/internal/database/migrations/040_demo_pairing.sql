CREATE TABLE demo_pairing_codes (
    code_hash BLOB PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX demo_pairing_codes_expires_at ON demo_pairing_codes(expires_at);
