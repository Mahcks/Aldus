package source

import "context"

// Read the recorded decision separately from grouping evidence. Prefer the
// durable proposal or acquisition scan link so ordinary rescans and regenerated
// groups do not erase the last recorded explanation. This does not authorize import.
func (s *Store) acquisitionReviewReasons(ctx context.Context, libraryID, proposalID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT DISTINCT o.reason
		FROM acquisition_import_outcomes o
		JOIN acquisition_requests ar ON ar.id=o.acquisition_request_id
		WHERE ar.library_id=? AND o.state IN ('needs_review','failed') AND o.reason!=''
		AND (o.proposal_id=? OR EXISTS(
			SELECT 1 FROM import_items i JOIN source_entries e ON e.id=i.source_entry_id
			WHERE i.group_id=? AND e.source_id=ar.source_id AND COALESCE(e.acquisition_scan_id,e.last_seen_scan_id)=o.scan_id))
		ORDER BY o.reason`, libraryID, proposalID, proposalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var reasons []string
	for rows.Next() {
		var reason string
		if err := rows.Scan(&reason); err != nil {
			return nil, err
		}
		reasons = append(reasons, reason)
	}
	return reasons, rows.Err()
}
