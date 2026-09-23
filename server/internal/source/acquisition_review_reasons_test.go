package source

import (
	"context"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
)

func TestProposalExposesRecordedAcquisitionReviewReason(t *testing.T) {
	store, db, root := outcomeFixture(t, "")
	addOutcomeProposal(t, db, root, "request", "scan", "proposal", "audiobook", "high")
	const reason = "The downloaded book's embedded title or author does not confirm the requested book. Review the files before importing."
	if err := store.saveAcquisitionOutcome(context.Background(), "request", "scan", "needs_review", "proposal", "", reason); err != nil {
		t.Fatal(err)
	}
	// A later ordinary scan must not hide a decision recorded for this proposal.
	if _, err := db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at) VALUES('later','source','completed','2026-01-02T00:00:00Z'); UPDATE source_entries SET last_seen_scan_id='later' WHERE id='proposal-entry'`); err != nil {
		t.Fatal(err)
	}
	proposal, err := store.Proposal(context.Background(), auth.User{Admin: true}, "library", "proposal")
	if err != nil {
		t.Fatal(err)
	}
	if len(proposal.ReviewReasons) != 1 || proposal.ReviewReasons[0] != reason {
		t.Fatalf("proposal hides recorded review reason: %+v", proposal)
	}
	if proposal.Confidence != "high" || len(proposal.Reasons) != 0 {
		t.Fatalf("acquisition decision must remain separate from grouping evidence: %+v", proposal)
	}
}

func TestAcquisitionReviewReasonsScope(t *testing.T) {
	store, db, root := outcomeFixture(t, "")
	addOutcomeProposal(t, db, root, "request", "scan", "proposal", "audiobook", "high")
	ctx := context.Background()
	const reason = "Multiple books were found in the completed download; review the import proposals."
	for _, state := range []string{"needs_review", "failed", "pending", "accepted"} {
		if err := store.saveAcquisitionOutcome(ctx, "request", "scan", state, "", "", reason); err != nil {
			t.Fatal(err)
		}
		proposal, err := store.Proposal(ctx, auth.User{Admin: true}, "library", "proposal")
		if err != nil {
			t.Fatal(err)
		}
		want := 0
		if state == "needs_review" || state == "failed" {
			want = 1
		}
		if len(proposal.ReviewReasons) != want || (want == 1 && proposal.ReviewReasons[0] != reason) {
			t.Fatalf("state=%s reasons=%v", state, proposal.ReviewReasons)
		}
	}
	if err := store.saveAcquisitionOutcome(ctx, "request", "scan", "needs_review", "proposal", "", reason); err != nil {
		t.Fatal(err)
	}
	reasons, err := store.acquisitionReviewReasons(ctx, "other-library", "proposal")
	if err != nil || len(reasons) != 0 {
		t.Fatalf("cross-library reasons=%v err=%v", reasons, err)
	}
	reasons, err = store.acquisitionReviewReasons(ctx, "library", "unrelated-proposal")
	if err != nil || len(reasons) != 0 {
		t.Fatalf("unrelated proposal reasons=%v err=%v", reasons, err)
	}
}

func TestAcquisitionReviewReasonSurvivesOrdinaryScanWithoutRegrouping(t *testing.T) {
	store, db, root := outcomeFixture(t, "")
	addOutcomeProposal(t, db, root, "request", "scan", "proposal", "audiobook", "high")
	ctx := context.Background()
	// Start with the actual embedded metadata and an album-based proposal.
	if _, err := db.Exec(`DELETE FROM import_items; DELETE FROM import_groups;
		UPDATE source_entries SET acquisition_scan_id='scan',metadata_json='{"tags":{"album":"Sunrise on the Reaping (Unabridged)","title":"Sunrise on the Reaping","album_artist":"Suzanne Collins","artist":"Suzanne Collins","composer":"Jefferson White"}}' WHERE id='proposal-entry'`); err != nil {
		t.Fatal(err)
	}
	if err := store.GenerateProposals(ctx, "library"); err != nil {
		t.Fatal(err)
	}
	proposals, err := store.Proposals(ctx, auth.User{Admin: true}, "library")
	if err != nil || len(proposals) != 1 {
		t.Fatalf("proposals=%+v err=%v", proposals, err)
	}
	original := proposals[0]
	const reason = "The downloaded book's embedded title or author does not confirm the requested book. Review the files before importing."
	if err := store.saveAcquisitionOutcome(ctx, "request", "scan", "needs_review", original.ID, "", reason); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at) VALUES('later','source','completed','2026-01-02T00:00:00Z'); UPDATE source_entries SET last_seen_scan_id='later' WHERE id='proposal-entry'`); err != nil {
		t.Fatal(err)
	}
	if err := store.GenerateProposals(ctx, "library"); err != nil {
		t.Fatal(err)
	}
	p, err := store.Proposal(ctx, auth.User{Admin: true}, "library", original.ID)
	if err != nil {
		t.Fatal(err)
	}
	if p.Revision != original.Revision || p.Title != "Sunrise on the Reaping (Unabridged)" || p.Confidence != "high" || len(p.ReviewReasons) != 1 || p.ReviewReasons[0] != reason {
		t.Fatalf("ordinary rescan changed grouping or lost acquisition review evidence: %+v", p)
	}
	var state string
	if err := db.QueryRow(`SELECT state FROM acquisition_import_outcomes WHERE acquisition_request_id='request'`).Scan(&state); err != nil || state != "needs_review" {
		t.Fatalf("state=%s err=%v", state, err)
	}
	// Scan-wide reasons also survive loss of last_seen_scan_id through the
	// durable acquisition_scan_id, without assigning a new proposal link.
	if err := store.saveAcquisitionOutcome(ctx, "request", "scan", "needs_review", "", "", reason); err != nil {
		t.Fatal(err)
	}
	p, err = store.Proposal(ctx, auth.User{Admin: true}, "library", original.ID)
	if err != nil || len(p.ReviewReasons) != 1 || p.ReviewReasons[0] != reason {
		t.Fatalf("scan-wide reasons=%v err=%v", p.ReviewReasons, err)
	}
}
