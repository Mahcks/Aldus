CREATE TABLE IF NOT EXISTS works (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES works(id),
    kind TEXT NOT NULL CHECK (kind IN ('epub', 'audio')),
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    created_at TEXT NOT NULL,
    UNIQUE (work_id, kind, sha256)
);

CREATE TABLE IF NOT EXISTS koreader_aliases (
    document_id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL REFERENCES media(id)
);

CREATE TABLE IF NOT EXISTS alignments (
    id TEXT PRIMARY KEY,
    epub_media_id TEXT NOT NULL REFERENCES media(id),
    audio_media_id TEXT NOT NULL REFERENCES media(id),
    revision INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'ready', 'failed', 'stale')),
    created_at TEXT NOT NULL,
    UNIQUE (epub_media_id, audio_media_id, revision)
);

CREATE TABLE IF NOT EXISTS alignment_segments (
    alignment_id TEXT NOT NULL REFERENCES alignments(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    text TEXT NOT NULL,
    surrounding_text TEXT NOT NULL DEFAULT '',
    epub_href TEXT NOT NULL,
    epub_locator TEXT NOT NULL,
    koreader_locator TEXT NOT NULL,
    audio_resource TEXT NOT NULL,
    audio_start_ms INTEGER NOT NULL CHECK (audio_start_ms >= 0),
    audio_end_ms INTEGER NOT NULL CHECK (audio_end_ms > audio_start_ms),
    word_timings TEXT,
    PRIMARY KEY (alignment_id, id),
    UNIQUE (alignment_id, ordinal),
    UNIQUE (alignment_id, epub_href, epub_locator),
    UNIQUE (alignment_id, koreader_locator)
);

CREATE TABLE IF NOT EXISTS progress (
    alignment_id TEXT PRIMARY KEY REFERENCES alignments(id) ON DELETE CASCADE,
    segment_id TEXT NOT NULL,
    offset INTEGER NOT NULL CHECK (offset BETWEEN 0 AND 1000000),
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL,
    source_device TEXT NOT NULL,
    FOREIGN KEY (alignment_id, segment_id) REFERENCES alignment_segments(alignment_id, id)
);
