ALTER TABLE acquisition_requests ADD COLUMN dismissed_at TEXT NOT NULL DEFAULT '';
CREATE INDEX acquisition_requests_requester_updates ON acquisition_requests(requested_by,dismissed_at,updated_at DESC);
