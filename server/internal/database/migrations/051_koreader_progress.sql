ALTER TABLE koreader_aliases RENAME TO legacy_koreader_aliases;

CREATE TABLE koreader_aliases (
    document_id TEXT NOT NULL,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id,media_id)
);

INSERT INTO koreader_aliases(document_id,media_id)
SELECT document_id,media_id FROM legacy_koreader_aliases;

DROP TABLE legacy_koreader_aliases;

CREATE INDEX koreader_aliases_document ON koreader_aliases(document_id);

ALTER TABLE progress ADD COLUMN source_device_id TEXT NOT NULL DEFAULT '';

CREATE TABLE koreader_progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    progress TEXT NOT NULL CHECK (length(trim(progress)) > 0),
    percentage REAL NOT NULL CHECK (percentage BETWEEN 0 AND 1),
    device TEXT NOT NULL CHECK (length(trim(device)) > 0),
    device_id TEXT NOT NULL CHECK (length(trim(device_id)) > 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id,media_id)
);
