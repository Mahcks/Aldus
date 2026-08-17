CREATE TABLE acquisition_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    indexer_url TEXT NOT NULL DEFAULT '',
    indexer_api_key TEXT NOT NULL DEFAULT '',
    qbittorrent_url TEXT NOT NULL DEFAULT '',
    qbittorrent_username TEXT NOT NULL DEFAULT '',
    qbittorrent_password TEXT NOT NULL DEFAULT '',
    qbittorrent_category TEXT NOT NULL DEFAULT 'aldus',
    updated_at TEXT NOT NULL
);
