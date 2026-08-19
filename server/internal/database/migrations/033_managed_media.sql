ALTER TABLE library_sources ADD COLUMN storage_kind TEXT NOT NULL DEFAULT 'referenced'
    CHECK (storage_kind IN ('referenced','managed'));

CREATE UNIQUE INDEX library_sources_one_managed_acquisition
    ON library_sources(library_id)
    WHERE storage_kind='managed' AND deleted_at IS NULL;

ALTER TABLE acquisition_requests ADD COLUMN managed_relative_path TEXT NOT NULL DEFAULT '';
