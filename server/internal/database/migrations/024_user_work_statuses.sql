CREATE TABLE user_work_statuses (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('want_to_read', 'reading', 'finished')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, work_id)
);

CREATE INDEX user_work_statuses_user_status
    ON user_work_statuses(user_id, status, updated_at DESC);
