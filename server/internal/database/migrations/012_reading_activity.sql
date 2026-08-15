CREATE TABLE reading_activity_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('read','listen')),
    started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    ended_at TEXT,
    active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds BETWEEN 0 AND 86400)
);

CREATE INDEX reading_activity_user_work ON reading_activity_sessions(user_id,work_id,started_at DESC);
