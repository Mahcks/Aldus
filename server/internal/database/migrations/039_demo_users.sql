ALTER TABLE users ADD COLUMN demo_expires_at TEXT;

CREATE INDEX users_demo_expires_at ON users(demo_expires_at) WHERE demo_expires_at IS NOT NULL;
