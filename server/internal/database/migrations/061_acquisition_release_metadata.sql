-- Keep provider metadata through discovery, selection and restart. Raw provider
-- identifiers stay internal and are never copied wholesale into API responses.
ALTER TABLE acquisition_results
    ADD COLUMN release_metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE acquisition_requests
    ADD COLUMN selected_release_metadata TEXT NOT NULL DEFAULT '{}';
