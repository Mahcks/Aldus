ALTER TABLE acquisition_requests ADD COLUMN qbit_state TEXT NOT NULL DEFAULT '';

CREATE TABLE acquisition_release_failures (
    title_request_id TEXT NOT NULL REFERENCES title_requests(id) ON DELETE CASCADE,
    format TEXT NOT NULL CHECK (format IN ('ebook', 'audiobook')),
    download_url TEXT NOT NULL,
    info_hash TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    failed_at TEXT NOT NULL,
    PRIMARY KEY (title_request_id, format, download_url)
);

CREATE INDEX acquisition_release_failures_hash_idx
    ON acquisition_release_failures(title_request_id, format, info_hash)
    WHERE info_hash != '';
