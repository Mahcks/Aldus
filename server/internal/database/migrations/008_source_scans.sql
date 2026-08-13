CREATE TABLE source_scans (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES library_sources(id),
    state TEXT NOT NULL CHECK (state IN ('pending','scanning','completed','failed')),
    files_visited INTEGER NOT NULL DEFAULT 0,
    supported_count INTEGER NOT NULL DEFAULT 0,
    epub_count INTEGER NOT NULL DEFAULT 0,
    audio_count INTEGER NOT NULL DEFAULT 0,
    new_count INTEGER NOT NULL DEFAULT 0,
    changed_count INTEGER NOT NULL DEFAULT 0,
    unchanged_count INTEGER NOT NULL DEFAULT 0,
    missing_count INTEGER NOT NULL DEFAULT 0,
    problem_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
);
CREATE INDEX source_scans_source_id ON source_scans(source_id,created_at DESC);
CREATE UNIQUE INDEX source_scans_one_active ON source_scans(source_id) WHERE state IN ('pending','scanning');

ALTER TABLE source_entries ADD COLUMN detected_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE source_entries ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE source_entries ADD COLUMN path_hints_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE source_entries ADD COLUMN last_seen_scan_id TEXT REFERENCES source_scans(id);
ALTER TABLE source_entries ADD COLUMN error_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE source_entries ADD COLUMN device INTEGER;
ALTER TABLE source_entries ADD COLUMN inode INTEGER;
CREATE INDEX source_entries_last_seen_scan_id ON source_entries(last_seen_scan_id);
