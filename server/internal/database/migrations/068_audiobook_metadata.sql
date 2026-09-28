CREATE TABLE representation_metadata_sources (
    representation_id TEXT NOT NULL REFERENCES representations(id) ON DELETE CASCADE,
    field TEXT NOT NULL CHECK(field IN ('narrators', 'description')),
    asin TEXT NOT NULL,
    region TEXT NOT NULL,
    value TEXT NOT NULL,
    recording TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(representation_id, field)
);
