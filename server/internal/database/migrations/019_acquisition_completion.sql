ALTER TABLE acquisition_settings ADD COLUMN indexer_kind TEXT NOT NULL DEFAULT 'prowlarr'
    CHECK (indexer_kind IN ('prowlarr','torznab'));
ALTER TABLE acquisition_settings ADD COLUMN qbittorrent_download_root TEXT NOT NULL DEFAULT '';

ALTER TABLE acquisition_requests ADD COLUMN source_id TEXT REFERENCES library_sources(id);
ALTER TABLE acquisition_requests ADD COLUMN download_state TEXT NOT NULL DEFAULT ''
    CHECK (download_state IN ('','downloading','ready'));
ALTER TABLE acquisition_requests ADD COLUMN download_error TEXT NOT NULL DEFAULT '';
