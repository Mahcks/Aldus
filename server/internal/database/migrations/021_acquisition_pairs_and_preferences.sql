CREATE TABLE acquisition_pairs (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    requested_by TEXT NOT NULL REFERENCES users(id),
    query TEXT NOT NULL,
    work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

ALTER TABLE acquisition_requests ADD COLUMN pair_id TEXT REFERENCES acquisition_pairs(id) ON DELETE SET NULL;
ALTER TABLE acquisition_requests ADD COLUMN advisory_title TEXT NOT NULL DEFAULT '';
ALTER TABLE acquisition_requests ADD COLUMN advisory_author TEXT NOT NULL DEFAULT '';
ALTER TABLE acquisition_requests ADD COLUMN advisory_isbn TEXT NOT NULL DEFAULT '';
ALTER TABLE acquisition_requests ADD COLUMN advisory_year INTEGER NOT NULL DEFAULT 0;
ALTER TABLE acquisition_requests ADD COLUMN advisory_cover_url TEXT NOT NULL DEFAULT '';
ALTER TABLE acquisition_requests ADD COLUMN advisory_source TEXT NOT NULL DEFAULT '';
CREATE INDEX acquisition_requests_pair ON acquisition_requests(pair_id,created_at,id);

CREATE TABLE work_metadata (
    work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
    isbn TEXT NOT NULL DEFAULT '',
    first_publish_year INTEGER NOT NULL DEFAULT 0,
    cover_url TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE user_work_preferences (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    epub_media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    audio_media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    alignment_id TEXT NOT NULL REFERENCES alignments(id) ON DELETE CASCADE,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id,work_id)
);
