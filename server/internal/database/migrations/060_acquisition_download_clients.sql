-- Keep the connection that received each job, independently of the current default.
CREATE TABLE acquisition_download_clients (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind = 'qbittorrent'),
    url TEXT NOT NULL,
    username TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    download_root TEXT NOT NULL DEFAULT '',
    UNIQUE (kind, url, category, download_root)
);

ALTER TABLE acquisition_requests
    ADD COLUMN download_client_id TEXT REFERENCES acquisition_download_clients(id);

CREATE INDEX acquisition_requests_download_client
    ON acquisition_requests(download_client_id);

-- Database-configured jobs can be bound during migration. Environment-configured
-- installations are bound before their first client operation or settings change.
INSERT INTO acquisition_download_clients (id, kind, url, username, password, category, download_root)
SELECT 'legacy-qbittorrent', 'qbittorrent', rtrim(qbittorrent_url, '/'),
    qbittorrent_username, qbittorrent_password, qbittorrent_category, qbittorrent_download_root
FROM acquisition_settings
WHERE qbittorrent_url != '';

UPDATE acquisition_requests
SET download_client_id = 'legacy-qbittorrent'
WHERE (COALESCE(selected_url, '') != '' OR torrent_hash != '')
    AND EXISTS (SELECT 1 FROM acquisition_download_clients WHERE id = 'legacy-qbittorrent');
