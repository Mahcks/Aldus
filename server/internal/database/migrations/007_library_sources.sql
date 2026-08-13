CREATE TABLE library_sources (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES libraries(id),
    kind TEXT NOT NULL CHECK (kind = 'local'),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    root_path TEXT NOT NULL CHECK (length(trim(root_path)) > 0),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX library_sources_library_id ON library_sources(library_id);

CREATE TABLE source_entries (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES library_sources(id),
    relative_path TEXT NOT NULL CHECK (length(relative_path) > 0),
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    modified_at TEXT NOT NULL,
    sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
    state TEXT NOT NULL DEFAULT 'registered' CHECK (state IN ('registered','missing','changed','error')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (source_id, relative_path)
);

ALTER TABLE media ADD COLUMN storage_kind TEXT NOT NULL DEFAULT 'managed' CHECK (storage_kind IN ('managed','referenced'));
ALTER TABLE media ADD COLUMN source_entry_id TEXT REFERENCES source_entries(id);
CREATE INDEX media_source_entry_id ON media(source_entry_id);

CREATE TRIGGER media_provenance_insert
BEFORE INSERT ON media
WHEN (NEW.storage_kind = 'managed' AND NEW.source_entry_id IS NOT NULL)
  OR (NEW.storage_kind = 'referenced' AND NEW.source_entry_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'invalid media provenance'); END;

CREATE TRIGGER media_provenance_update
BEFORE UPDATE OF storage_kind,source_entry_id ON media
WHEN (NEW.storage_kind = 'managed' AND NEW.source_entry_id IS NOT NULL)
  OR (NEW.storage_kind = 'referenced' AND NEW.source_entry_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'invalid media provenance'); END;
