CREATE TABLE acquisition_policies (
    library_id TEXT PRIMARY KEY REFERENCES libraries(id) ON DELETE CASCADE,
    default_ebook_source_id TEXT REFERENCES library_sources(id),
    default_audiobook_source_id TEXT REFERENCES library_sources(id),
    max_ebook_bytes INTEGER NOT NULL DEFAULT 209715200 CHECK (max_ebook_bytes BETWEEN 1024 AND 1099511627776),
    max_audiobook_bytes INTEGER NOT NULL DEFAULT 5368709120 CHECK (max_audiobook_bytes BETWEEN 1024 AND 1099511627776),
    allowed_ebook_extensions TEXT NOT NULL DEFAULT 'epub',
    allowed_audiobook_extensions TEXT NOT NULL DEFAULT 'm4b,mp3',
    preferred_language TEXT NOT NULL DEFAULT 'en',
    allow_abridged INTEGER NOT NULL DEFAULT 0 CHECK (allow_abridged IN (0,1)),
    max_active_requests INTEGER NOT NULL DEFAULT 5 CHECK (max_active_requests BETWEEN 1 AND 100),
    updated_at TEXT NOT NULL
);
