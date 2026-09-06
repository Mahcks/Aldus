CREATE TABLE work_metadata_sources (
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    field TEXT NOT NULL CHECK(field IN ('title','author','description','isbn','publisher','language','first_publish_year','subjects','cover_url')),
    source TEXT NOT NULL,
    provider_work_id TEXT NOT NULL,
    provider_edition_id TEXT NOT NULL DEFAULT '',
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(work_id, field)
);
