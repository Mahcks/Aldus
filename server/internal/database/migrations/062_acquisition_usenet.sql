-- Preserve original connections and job identities across transport types.
CREATE TABLE acquisition_download_clients_next (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('qbittorrent', 'sabnzbd')),
    url TEXT NOT NULL,
    username TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    download_root TEXT NOT NULL DEFAULT '',
    UNIQUE (kind, url, category, download_root)
);
INSERT INTO acquisition_download_clients_next SELECT * FROM acquisition_download_clients;
DROP TABLE acquisition_download_clients;
ALTER TABLE acquisition_download_clients_next RENAME TO acquisition_download_clients;
ALTER TABLE acquisition_requests RENAME COLUMN torrent_hash TO download_job_id;
ALTER TABLE acquisition_requests RENAME COLUMN qbit_state TO client_state;

CREATE TABLE acquisition_settings_next (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    indexer_url TEXT NOT NULL DEFAULT '',
    indexer_api_key TEXT NOT NULL DEFAULT '',
    qbittorrent_url TEXT NOT NULL DEFAULT '',
    qbittorrent_username TEXT NOT NULL DEFAULT '',
    qbittorrent_password TEXT NOT NULL DEFAULT '',
    qbittorrent_category TEXT NOT NULL DEFAULT 'aldus',
    updated_at TEXT NOT NULL,
    indexer_kind TEXT NOT NULL DEFAULT 'prowlarr'
        CHECK (indexer_kind IN ('prowlarr', 'torznab', 'newznab')),
    qbittorrent_download_root TEXT NOT NULL DEFAULT '',
    nyt_api_key TEXT NOT NULL DEFAULT '',
    sabnzbd_url TEXT NOT NULL DEFAULT '',
    sabnzbd_api_key TEXT NOT NULL DEFAULT '',
    sabnzbd_category TEXT NOT NULL DEFAULT '',
    sabnzbd_download_root TEXT NOT NULL DEFAULT ''
);
INSERT INTO acquisition_settings_next (
    id, indexer_url, indexer_api_key, qbittorrent_url, qbittorrent_username,
    qbittorrent_password, qbittorrent_category, updated_at, indexer_kind,
    qbittorrent_download_root, nyt_api_key
)
SELECT id, indexer_url, indexer_api_key, qbittorrent_url, qbittorrent_username,
    qbittorrent_password, qbittorrent_category, updated_at, indexer_kind,
    qbittorrent_download_root, nyt_api_key
FROM acquisition_settings;
DROP TABLE acquisition_settings;
ALTER TABLE acquisition_settings_next RENAME TO acquisition_settings;
