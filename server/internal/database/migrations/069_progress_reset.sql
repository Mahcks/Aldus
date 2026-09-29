-- Retain a revision even when there is no canonical location. An old save must
-- conflict with a reset rather than recreate the previous position at revision 0.
CREATE TABLE progress_resets (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0),
    ownership_epoch INTEGER NOT NULL CHECK (ownership_epoch > 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, work_id)
);
