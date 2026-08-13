CREATE TABLE import_groups (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES libraries(id),
    logical_key TEXT NOT NULL,
    content_key TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('proposed','review_required','obsolete')),
    confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
    proposed_title TEXT NOT NULL,
    proposed_author TEXT NOT NULL DEFAULT '',
    normalized_title TEXT NOT NULL DEFAULT '',
    normalized_author TEXT NOT NULL DEFAULT '',
    reasons_json TEXT NOT NULL DEFAULT '[]',
    existing_work_id TEXT REFERENCES works(id),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (library_id,logical_key)
);
CREATE INDEX import_groups_library_id ON import_groups(library_id,state,updated_at DESC);

CREATE TABLE import_items (
    group_id TEXT NOT NULL REFERENCES import_groups(id) ON DELETE CASCADE,
    source_entry_id TEXT NOT NULL REFERENCES source_entries(id),
    representation_kind TEXT NOT NULL CHECK (representation_kind IN ('epub','audiobook')),
    proposed_label TEXT NOT NULL,
    duplicate_of_entry_id TEXT REFERENCES source_entries(id),
    evidence_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (group_id,source_entry_id),
    UNIQUE (source_entry_id)
);
