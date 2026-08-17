ALTER TABLE library_members ADD COLUMN can_request_acquisitions INTEGER NOT NULL DEFAULT 0 CHECK (can_request_acquisitions IN (0,1));
UPDATE library_members SET can_request_acquisitions=1 WHERE role IN ('owner','editor');

ALTER TABLE users ADD COLUMN acquisition_seen_at TEXT NOT NULL DEFAULT '';
