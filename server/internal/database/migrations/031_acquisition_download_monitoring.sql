ALTER TABLE acquisition_requests ADD COLUMN torrent_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE acquisition_requests ADD COLUMN download_last_seen_at TEXT NOT NULL DEFAULT '';
ALTER TABLE acquisition_requests ADD COLUMN download_progress REAL NOT NULL DEFAULT 0 CHECK (download_progress BETWEEN 0 AND 1);
ALTER TABLE acquisition_requests ADD COLUMN download_progress_updated_at TEXT NOT NULL DEFAULT '';

UPDATE acquisition_requests
SET download_progress_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE fulfillment_state='downloading';
