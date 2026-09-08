-- A hash identifies a torrent, not who created it. Existing and recovered
-- submissions remain protected until ownership is explicitly established.
ALTER TABLE acquisition_requests ADD COLUMN torrent_ownership TEXT NOT NULL DEFAULT 'unknown'
    CHECK (torrent_ownership IN ('created', 'adopted', 'unknown'));
