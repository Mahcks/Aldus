CREATE TABLE acquisition_import_outcomes (
    acquisition_request_id TEXT PRIMARY KEY REFERENCES acquisition_requests(id) ON DELETE CASCADE,
    scan_id TEXT NOT NULL UNIQUE REFERENCES source_scans(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('pending','needs_review','accepted','failed')),
    proposal_id TEXT REFERENCES import_groups(id) ON DELETE SET NULL,
    accepted_work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

INSERT INTO acquisition_import_outcomes(acquisition_request_id,scan_id,state,reason,updated_at)
SELECT acquisition_request_id,id,
       CASE WHEN state='failed' THEN 'failed' ELSE 'pending' END,
       CASE WHEN state='failed' THEN COALESCE(NULLIF(error_summary,''),'Source scan failed.') ELSE '' END,
       COALESCE(finished_at,started_at,created_at)
FROM source_scans
WHERE acquisition_request_id IS NOT NULL;

UPDATE acquisition_import_outcomes
SET proposal_id=CASE WHEN (SELECT COUNT(DISTINCT i.group_id) FROM import_items i JOIN source_entries e ON e.id=i.source_entry_id WHERE e.last_seen_scan_id=acquisition_import_outcomes.scan_id)=1 THEN (
        SELECT MIN(i.group_id) FROM import_items i JOIN source_entries e ON e.id=i.source_entry_id WHERE e.last_seen_scan_id=acquisition_import_outcomes.scan_id
    ) END,
    accepted_work_id=(
        SELECT g.accepted_work_id
        FROM import_groups g
        WHERE g.id=(
            SELECT MIN(i.group_id)
            FROM import_items i
            JOIN source_entries e ON e.id=i.source_entry_id
            WHERE e.last_seen_scan_id=acquisition_import_outcomes.scan_id
        ) AND g.decision='accepted'
    ),
    state=CASE
        WHEN (SELECT COUNT(DISTINCT i.group_id) FROM import_items i JOIN source_entries e ON e.id=i.source_entry_id WHERE e.last_seen_scan_id=acquisition_import_outcomes.scan_id)=0 THEN 'failed'
        WHEN (SELECT COUNT(DISTINCT i.group_id) FROM import_items i JOIN source_entries e ON e.id=i.source_entry_id WHERE e.last_seen_scan_id=acquisition_import_outcomes.scan_id)>1 THEN 'needs_review'
        WHEN EXISTS(
            SELECT 1 FROM import_groups g
            WHERE g.id=(SELECT MIN(i.group_id) FROM import_items i JOIN source_entries e ON e.id=i.source_entry_id WHERE e.last_seen_scan_id=acquisition_import_outcomes.scan_id)
              AND g.decision='accepted'
        ) THEN 'accepted'
        ELSE 'needs_review'
    END,
    reason=CASE
        WHEN (SELECT COUNT(DISTINCT i.group_id) FROM import_items i JOIN source_entries e ON e.id=i.source_entry_id WHERE e.last_seen_scan_id=acquisition_import_outcomes.scan_id)=0 THEN 'No supported EPUB or audiobook was found in the completed download.'
        WHEN (SELECT COUNT(DISTINCT i.group_id) FROM import_items i JOIN source_entries e ON e.id=i.source_entry_id WHERE e.last_seen_scan_id=acquisition_import_outcomes.scan_id)>1 THEN 'Multiple books were found in the completed download; review the import proposals.'
        ELSE ''
    END
WHERE state='pending'
  AND EXISTS(SELECT 1 FROM source_scans sc WHERE sc.id=acquisition_import_outcomes.scan_id AND sc.state='completed');
