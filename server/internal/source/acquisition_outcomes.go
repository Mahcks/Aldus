package source

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

func (s *Store) processAcquisitionImport(ctx context.Context, libraryID, sourceID, scanID string) (int, error) {
	var requestID, targetWorkID string
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(sc.acquisition_request_id,''),COALESCE((SELECT COALESCE(NULLIF(tr.work_id,''),p.work_id) FROM acquisition_requests ar LEFT JOIN title_request_formats f ON f.legacy_acquisition_request_id=ar.id LEFT JOIN title_requests tr ON tr.id=f.title_request_id LEFT JOIN acquisition_pairs p ON p.id=ar.pair_id WHERE ar.id=sc.acquisition_request_id LIMIT 1),'') FROM source_scans sc WHERE sc.id=? AND sc.source_id=?`, scanID, sourceID).Scan(&requestID, &targetWorkID)
	if err != nil {
		return 0, err
	}
	if requestID == "" {
		return 0, nil
	}
	proposals, err := s.Proposals(ctx, auth.User{Admin: true}, libraryID)
	if err != nil {
		return 0, err
	}
	matched := make([]Proposal, 0, 1)
	for _, proposal := range proposals {
		var mismatches, items int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*),COUNT(CASE WHEN e.source_id!=? OR e.last_seen_scan_id!=? THEN 1 END) FROM import_items i JOIN source_entries e ON e.id=i.source_entry_id WHERE i.group_id=?`, sourceID, scanID, proposal.ID).Scan(&items, &mismatches); err != nil {
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
	if proposal.Confidence != "high" || proposal.State != "proposed" {
		return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "The downloaded files could not be matched with high confidence.")
	}
	if targetWorkID == "" && proposal.ExistingWorkID != "" {
		return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "A possible existing title was found; confirm whether this is another edition.")
	}
	if targetWorkID != "" {
		var valid bool
		if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM works WHERE id=? AND library_id=?)`, targetWorkID, libraryID).Scan(&valid); err != nil {
			return 0, err
		}
		if !valid {
			return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "failed", proposal.ID, "", "The requested target title is no longer available in this library.")
		}
		if proposal.ExistingWorkID != "" && proposal.ExistingWorkID != targetWorkID {
			return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "The download matches a different existing title and requires review.")
		}
		var existingKinds int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(DISTINCT i.representation_kind) FROM import_items i WHERE i.group_id=? AND EXISTS(SELECT 1 FROM representations r WHERE r.work_id=? AND r.kind=CASE i.representation_kind WHEN 'audiobook' THEN 'audio' ELSE i.representation_kind END)`, proposal.ID, targetWorkID).Scan(&existingKinds); err != nil {
			return 0, err
		}
		if existingKinds > 0 {
			return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "This title already has that format; review it as a possible different edition or narration.")
		}
	}
	items := make([]AcceptItem, len(proposal.Items))
	for i, item := range proposal.Items {
		items[i] = AcceptItem{SourceEntryID: item.EntryID, Kind: item.Kind, Label: item.Label}
	}
	workID, err := s.AcceptProposal(ctx, auth.User{Admin: true}, libraryID, proposal.ID, AcceptRequest{ExpectedRevision: proposal.Revision, WorkID: targetWorkID, Title: proposal.Title, Author: proposal.Author, Items: items})
	if err != nil {
		if errors.Is(err, ErrConflict) || errors.Is(err, ErrInvalid) {
			return 0, s.saveAcquisitionOutcome(ctx, requestID, scanID, "needs_review", proposal.ID, "", "The import changed while it was being processed; review the proposal.")
		}
		return 0, err
	}
	if err := s.saveAcquisitionOutcome(ctx, requestID, scanID, "accepted", proposal.ID, workID, ""); err != nil {
		return 0, err
	}
	return 1, nil
}

func (s *Store) saveAcquisitionOutcome(ctx context.Context, requestID, scanID, state, proposalID, workID, reason string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO acquisition_import_outcomes(acquisition_request_id,scan_id,state,proposal_id,accepted_work_id,reason,updated_at) VALUES(?,?,?,NULLIF(?,''),NULLIF(?,''),?,?) ON CONFLICT(acquisition_request_id) DO UPDATE SET scan_id=excluded.scan_id,state=excluded.state,proposal_id=excluded.proposal_id,accepted_work_id=excluded.accepted_work_id,reason=excluded.reason,updated_at=excluded.updated_at`, requestID, scanID, state, proposalID, workID, reason, time.Now().UTC().Format(time.RFC3339Nano))
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

func updateAcceptedOutcome(ctx context.Context, tx *sql.Tx, proposalID, workID, stamp string) error {
	_, err := tx.ExecContext(ctx, `UPDATE acquisition_import_outcomes SET state='accepted',accepted_work_id=?,reason='',updated_at=? WHERE proposal_id=?`, workID, stamp, proposalID)
	return err
}
