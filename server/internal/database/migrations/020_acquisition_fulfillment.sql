ALTER TABLE source_scans ADD COLUMN acquisition_request_id TEXT REFERENCES acquisition_requests(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX source_scans_acquisition_request ON source_scans(acquisition_request_id) WHERE acquisition_request_id IS NOT NULL;

ALTER TABLE acquisition_requests ADD COLUMN fulfillment_state TEXT NOT NULL DEFAULT 'awaiting_selection'
    CHECK (fulfillment_state IN ('awaiting_selection','submitting','downloading','scanning','needs_review','available','failed'));
ALTER TABLE acquisition_requests ADD COLUMN scan_id TEXT REFERENCES source_scans(id) ON DELETE SET NULL;
ALTER TABLE acquisition_requests ADD COLUMN proposal_id TEXT REFERENCES import_groups(id) ON DELETE SET NULL;
ALTER TABLE acquisition_requests ADD COLUMN work_id TEXT REFERENCES works(id) ON DELETE SET NULL;
ALTER TABLE acquisition_requests ADD COLUMN completed_relative_path TEXT NOT NULL DEFAULT '';

UPDATE acquisition_requests SET fulfillment_state=CASE
    WHEN download_state='downloading' THEN 'downloading'
    WHEN download_state='ready' THEN 'needs_review'
    ELSE 'awaiting_selection'
END;

CREATE INDEX acquisition_requests_fulfillment ON acquisition_requests(fulfillment_state,updated_at);
