CREATE TABLE work_covers (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('open_library','embedded','upload')),
    source_id TEXT NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    image_data BLOB,
    image_type TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (work_id,source,source_id)
);

ALTER TABLE works ADD COLUMN selected_cover_id TEXT REFERENCES work_covers(id) ON DELETE SET NULL;

CREATE INDEX work_covers_work ON work_covers(work_id,created_at DESC);
