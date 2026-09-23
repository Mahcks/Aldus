package source

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

var ErrAcquisitionMismatch = errors.New("Choose files in the requested format and the requested book. If the request was canceled, refresh the import review.")

func (s *Store) processAcquisitionImport(ctx context.Context, libraryID, sourceID, scanID string) (int, error) {
	var requestID, targetWorkID, requestedTitle, requestedAuthor, outcomeScan, outcomeState string
	var autoImport bool
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(sc.acquisition_request_id,''),
		       COALESCE(NULLIF(tr.work_id,''),p.work_id,''),
		       COALESCE(NULLIF(tr.title,''),ar.advisory_title,''),
		       COALESCE(NULLIF(tr.author,''),ar.advisory_author,''),
		       ls.auto_import AND ls.enabled AND ls.deleted_at IS NULL,
		       COALESCE(o.scan_id,''),
		       COALESCE(o.state,'')
		FROM source_scans sc
		JOIN library_sources ls ON ls.id=sc.source_id
		LEFT JOIN acquisition_requests ar ON ar.id=sc.acquisition_request_id
		LEFT JOIN title_request_formats f ON f.legacy_acquisition_request_id=ar.id
		LEFT JOIN title_requests tr ON tr.id=f.title_request_id
		LEFT JOIN acquisition_pairs p ON p.id=ar.pair_id
		LEFT JOIN acquisition_import_outcomes o ON o.acquisition_request_id=ar.id
		WHERE sc.id=? AND sc.source_id=? AND ls.library_id=?
	`, scanID, sourceID, libraryID).Scan(
		&requestID,
		&targetWorkID,
		&requestedTitle,
		&requestedAuthor,
		&autoImport,
		&outcomeScan,
		&outcomeState,
	)
	if err != nil {
		return 0, err
	}
	if requestID == "" || (outcomeScan != "" && outcomeScan != scanID) || outcomeState == "accepted" {
		return 0, nil
	}

	proposals, err := s.Proposals(ctx, auth.User{Admin: true}, libraryID)
	if err != nil {
		return 0, err
	}

	matched := make([]Proposal, 0, 1)
	for _, proposal := range proposals {
		var mismatches, items int
		if err := s.db.QueryRowContext(ctx, `
			SELECT COUNT(*),
			       COUNT(CASE WHEN e.source_id!=? OR e.last_seen_scan_id IS NULL
			                       OR e.last_seen_scan_id!=? THEN 1 END)
			FROM import_items i
			JOIN source_entries e ON e.id=i.source_entry_id
			WHERE i.group_id=?
		`, sourceID, scanID, proposal.ID).Scan(&items, &mismatches); err != nil {
			return 0, err
		}
		if items > 0 && mismatches == 0 {
			matched = append(matched, proposal)
		}
	}
	if len(matched) == 0 {
		return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "failed", "", "", "No supported EPUB or audiobook was found in the completed download.")
	}
	if len(matched) > 1 {
		return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", "", "", "Multiple books were found in the completed download; review the import proposals.")
	}

	proposal := matched[0]
	var requestedKind string
	if err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE((
		    SELECT CASE format WHEN 'ebook' THEN 'epub' ELSE 'audiobook' END
		    FROM title_request_formats
		    WHERE legacy_acquisition_request_id=?
		),'')
	`, requestID).Scan(&requestedKind); err != nil {
		return 0, err
	}
	if requestedKind != "" {
		matches := false
		for _, item := range proposal.Items {
			if item.Kind == requestedKind || (requestedKind == "audiobook" && item.Kind == "audio") {
				matches = true
			}
		}
		if !matches {
			return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "The download does not contain the requested format. Review the files or retry with another release.")
		}
	}
	if proposal.Confidence != "high" || proposal.State != "proposed" {
		return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "The downloaded files could not be matched with high confidence.")
	}
	if targetWorkID == "" && proposal.ExistingWorkID != "" {
		return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "A possible existing title was found; confirm whether this is another edition.")
	}
	if targetWorkID != "" {
		err := s.db.QueryRowContext(ctx, `
			SELECT title, COALESCE(author,'')
			FROM works
			WHERE id=?
			AND library_id=?
		`, targetWorkID, libraryID).Scan(&requestedTitle, &requestedAuthor)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return 0, err
		}
		if errors.Is(err, sql.ErrNoRows) {
			return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "failed", proposal.ID, "", "The requested target title is no longer available in this library.")
		}
		if proposal.ExistingWorkID != "" && proposal.ExistingWorkID != targetWorkID {
			return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "The download matches a different existing title and requires review.")
		}
		var existingKinds int
		if err := s.db.QueryRowContext(ctx, `
			SELECT COUNT(DISTINCT i.representation_kind)
			FROM import_items i
			WHERE i.group_id=? AND EXISTS(
			    SELECT 1 FROM representations r
			    WHERE r.work_id=?
			      AND r.kind=CASE i.representation_kind WHEN 'audiobook' THEN 'audio' ELSE i.representation_kind END
			)
		`, proposal.ID, targetWorkID).Scan(&existingKinds); err != nil {
			return 0, err
		}
		if existingKinds > 0 {
			return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "This title already has that format; review it as a possible different edition or narration.")
		}
	}

	if !autoImport {
		return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "Automatic import is turned off for this source. Review the downloaded book.")
	}
	if requestedTitle != "" {
		matches, err := s.acquisitionIdentityMatches(ctx, proposal.ID, requestedTitle, requestedAuthor)
		if err != nil {
			return 0, err
		}
		if !matches {
			return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "The downloaded book's embedded title or author does not confirm the requested book. Review the files before importing.")
		}
	}

	// Bind first so acceptance and its outcome commit in the same transaction.
	if err := s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "Ready to import the downloaded book."); err != nil {
		return 0, err
	}
	items := make([]AcceptItem, len(proposal.Items))
	for i, item := range proposal.Items {
		items[i] = AcceptItem{SourceEntryID: item.EntryID, Kind: item.Kind, Label: item.Label}
	}

	_, err = s.AcceptProposal(ctx, auth.User{Admin: true}, libraryID, proposal.ID, AcceptRequest{
		ExpectedRevision:     proposal.Revision,
		AcquisitionRequestID: requestID,
		WorkID:               targetWorkID,
		Title:                proposal.Title,
		Author:               proposal.Author,
		Items:                items,
	})
	if err != nil {
		if errors.Is(err, ErrConflict) || errors.Is(err, ErrInvalid) {
			return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "The import changed while it was being processed; review the proposal.")
		}
		return 0, err
	}

	return 1, nil
}

func (s *Store) acquisitionIdentityMatches(ctx context.Context, proposalID, title, author string) (bool, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT e.detected_kind, e.metadata_json
		FROM import_items i
		JOIN source_entries e ON e.id=i.source_entry_id
		WHERE i.group_id=?
	`, proposalID)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	requestedTitle := normalize(title)
	requestedAuthor := normalize(author)
	found := false
	for rows.Next() {
		var entry proposalEntry
		var raw string
		if err := rows.Scan(&entry.Kind, &raw); err != nil {
			return false, err
		}
		if err := json.Unmarshal([]byte(raw), &entry.Metadata); err != nil {
			return false, nil
		}
		// Preserve explicit album/edition matches before trying corroborated tags.
		embeddedTitle, embeddedAuthor := proposalIdentityMetadata(entry)
		if normalize(embeddedTitle) != requestedTitle {
			embeddedTitle, embeddedAuthor = identityMetadata(entry)
		}
		if requestedTitle == "" || normalize(embeddedTitle) != requestedTitle ||
			(requestedAuthor != "" && normalize(embeddedAuthor) != requestedAuthor) {
			return false, nil
		}
		found = true
	}
	return found, rows.Err()
}

func (s *Store) saveAcquisitionOutcome(ctx context.Context, requestID, scanID, state, proposalID, workID, reason string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO acquisition_import_outcomes
		    (acquisition_request_id,scan_id,state,proposal_id,accepted_work_id,reason,updated_at)
		VALUES(?,?,?,NULLIF(?,''),NULLIF(?,''),?,?)
		ON CONFLICT(acquisition_request_id) DO UPDATE SET
		    scan_id=excluded.scan_id,
		    state=excluded.state,
		    proposal_id=excluded.proposal_id,
		    accepted_work_id=excluded.accepted_work_id,
		    reason=excluded.reason,
		    updated_at=excluded.updated_at
		WHERE acquisition_import_outcomes.state!='accepted'
		  AND acquisition_import_outcomes.scan_id=excluded.scan_id
	`, requestID, scanID, state, proposalID, workID, reason, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("save acquisition import outcome: %w", err)
	}
	return nil
}

func (s *Store) failAcquisitionOutcome(ctx context.Context, scanID, reason string) error {
	var requestID string
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(acquisition_request_id,'') FROM source_scans WHERE id=?`, scanID).Scan(&requestID)
	if err != nil || requestID == "" {
		return err
	}
	return s.saveAcquisitionOutcome(ctx, requestID, scanID, "failed", "", "", reason)
}

// Every item must belong to the same acquisition scan; a matching title alone is
// never sufficient to bind an import to a family request.
const acquisitionProposalMatchSQL = `EXISTS(SELECT 1 FROM import_items WHERE group_id=?)
 AND NOT EXISTS(SELECT 1 FROM import_items i JOIN source_entries e ON e.id=i.source_entry_id
 WHERE i.group_id=? AND (e.source_id!=a.source_id OR e.last_seen_scan_id IS NULL OR e.last_seen_scan_id!=o.scan_id))`

func updateAcceptedOutcome(ctx context.Context, tx *sql.Tx, libraryID, proposalID, workID, requestID, stamp string) error {
	if requestID != "" {
		result, err := tx.ExecContext(ctx, `
			UPDATE acquisition_import_outcomes AS o SET proposal_id=?
			WHERE acquisition_request_id=? AND state='needs_review'
			  AND (proposal_id IS NULL OR proposal_id=?)
			  AND EXISTS(
			      SELECT 1 FROM acquisition_requests a
			      WHERE a.id=o.acquisition_request_id AND a.library_id=? AND
        `+acquisitionProposalMatchSQL+`)`,
			proposalID, requestID, proposalID, libraryID, proposalID, proposalID,
		)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return ErrConflict
		}
	}
	// Validate the imported media, not just the book or an existing representation.
	var invalid bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM acquisition_import_outcomes o
 JOIN acquisition_requests a ON a.id=o.acquisition_request_id
 JOIN title_request_formats f ON f.legacy_acquisition_request_id=a.id
 JOIN title_requests t ON t.id=f.title_request_id
 WHERE o.proposal_id=? AND o.state='needs_review' AND
 (f.state IN ('canceled','denied') OR (t.work_id IS NOT NULL AND t.work_id!=?) OR NOT EXISTS(
 SELECT 1 FROM media m JOIN representations r ON r.id=m.representation_id
 JOIN media_locations l ON l.media_id=m.id JOIN import_items i ON i.source_entry_id=l.source_entry_id
 WHERE r.work_id=? AND i.group_id=? AND m.kind=CASE f.format WHEN 'ebook' THEN 'epub' ELSE 'audio' END)))`, proposalID, workID, workID, proposalID).Scan(&invalid)
	if err != nil {
		return err
	}
	if invalid {
		return errors.Join(ErrInvalid, ErrAcquisitionMismatch)
	}
	_, err = tx.ExecContext(ctx, `UPDATE acquisition_import_outcomes SET state='accepted',accepted_work_id=?,reason='',updated_at=? WHERE proposal_id=? AND state='needs_review'`, workID, stamp, proposalID)
	return err
}

func settleUnboundAcquisition(ctx context.Context, tx *sql.Tx, libraryID, proposalID, stamp string) error {
	if _, err := tx.ExecContext(ctx, `UPDATE acquisition_import_outcomes AS o SET state='failed',reason='All import proposals from this download were dismissed or imported without fulfilling the request.',updated_at=?
 WHERE state='needs_review' AND proposal_id IS NULL
 AND EXISTS(SELECT 1 FROM acquisition_requests a WHERE a.id=o.acquisition_request_id AND a.library_id=? AND `+acquisitionProposalMatchSQL+`)
 AND NOT EXISTS(SELECT 1 FROM import_groups g JOIN import_items i ON i.group_id=g.id JOIN source_entries e ON e.id=i.source_entry_id WHERE g.decision='' AND e.last_seen_scan_id=o.scan_id)`, stamp, libraryID, proposalID, proposalID); err != nil {
		return err
	}
	return nil
}
