ALTER TABLE acquisition_requests ADD COLUMN advisory_description TEXT NOT NULL DEFAULT '';
ALTER TABLE acquisition_requests ADD COLUMN advisory_cover_id TEXT NOT NULL DEFAULT '';
ALTER TABLE work_metadata ADD COLUMN description TEXT NOT NULL DEFAULT '';
