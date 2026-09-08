-- Ordinary rescans update last_seen_scan_id; acquisition grouping needs a
-- stable reference to the scan that registered the downloaded payload.
ALTER TABLE source_entries ADD COLUMN acquisition_scan_id TEXT
    REFERENCES source_scans(id) ON DELETE SET NULL;

UPDATE source_entries
SET acquisition_scan_id=last_seen_scan_id
WHERE EXISTS (
    SELECT 1 FROM source_scans sc
    WHERE sc.id=source_entries.last_seen_scan_id
      AND sc.source_id=source_entries.source_id
      AND sc.acquisition_request_id IS NOT NULL
);
