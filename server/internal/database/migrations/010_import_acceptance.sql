ALTER TABLE import_groups ADD COLUMN accepted_work_id TEXT REFERENCES works(id);
ALTER TABLE import_groups ADD COLUMN decision TEXT NOT NULL DEFAULT '' CHECK (decision IN ('','accepted','ignored'));

CREATE TABLE media_locations (
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    source_entry_id TEXT NOT NULL REFERENCES source_entries(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (media_id,source_entry_id),
    UNIQUE (source_entry_id)
);
INSERT INTO media_locations(media_id,source_entry_id,created_at)
SELECT id,source_entry_id,created_at FROM media WHERE storage_kind='referenced' AND source_entry_id IS NOT NULL;
