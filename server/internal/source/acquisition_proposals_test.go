package source

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
)

func TestAcquisitionProposalsSeparatePriorFormat(t *testing.T) {
	ctx := context.Background()
	store, db, root := outcomeFixture(t, "")
	store.maxBytes = 16 << 20
	if _, err := db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at)
		VALUES('ordinary','source','completed','2026-01-01')`); err != nil {
		t.Fatal(err)
	}

	registerProposalMedia(t, store, root, "ordinary", "old.epub", "epub", "Book")
	if err := store.GenerateProposals(ctx, "library"); err != nil {
		t.Fatal(err)
	}
	prior := onlyProposal(t, store)
	workID, err := store.AcceptProposal(ctx, auth.User{Admin: true}, "library", prior.ID, AcceptRequest{
		ExpectedRevision: prior.Revision,
		Title:            prior.Title, Author: prior.Author,
		Items: []AcceptItem{{SourceEntryID: prior.Items[0].EntryID, Kind: "epub", Label: "EPUB"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	linkOutcomeTarget(t, db, workID)

	registerProposalMedia(t, store, root, "scan", "new.mp3", "audio", "Book")
	if err := store.GenerateProposals(ctx, "library"); err != nil {
		t.Fatal(err)
	}
	audio := onlyProposal(t, store)
	if len(audio.Items) != 1 || audio.Items[0].Kind != "audiobook" || audio.ExistingWorkID != workID {
		t.Fatalf("acquisition mixed with prior ebook: %#v", audio)
	}

	imported, err := store.processAcquisitionImport(ctx, "library", "source", "scan")
	if err != nil || imported != 1 {
		t.Fatalf("imported=%d err=%v", imported, err)
	}
	assertOutcome(t, db, "request", "accepted", audio.ID, true)

	// Simulate a pre-upgrade grouping key. Rekey the same accepted content in
	// place so the acquisition outcome still refers to its original proposal.
	if _, err := db.Exec(`UPDATE import_groups SET logical_key='legacy-audio-key' WHERE id=?`, audio.ID); err != nil {
		t.Fatal(err)
	}

	// Retaining acquisition provenance must not depend on the scan's request
	// link remaining populated (the foreign key uses ON DELETE SET NULL).
	if _, err := db.Exec(`UPDATE source_scans SET acquisition_request_id=NULL WHERE id='scan'`); err != nil {
		t.Fatal(err)
	}

	// A later ordinary scan must not erase acquisition grouping or reopen imports.
	registerProposalMedia(t, store, root, "ordinary", "new.mp3", "audio", "Book")
	for range 2 {
		if err := store.GenerateProposals(ctx, "library"); err != nil {
			t.Fatal(err)
		}
		proposals, err := store.Proposals(ctx, auth.User{Admin: true}, "library")
		if err != nil || len(proposals) != 0 {
			t.Fatalf("accepted proposals reopened: %#v err=%v", proposals, err)
		}
	}

	assertOutcome(t, db, "request", "accepted", audio.ID, true)

	var works, representations, media int
	if err := db.QueryRow(`SELECT
		(SELECT COUNT(*) FROM works),
		(SELECT COUNT(*) FROM representations WHERE work_id=?),
		(SELECT COUNT(*) FROM media)
	`, workID).Scan(&works, &representations, &media); err != nil {
		t.Fatal(err)
	}
	if works != 1 || representations != 2 || media != 2 {
		t.Fatalf("works=%d representations=%d media=%d", works, representations, media)
	}
}

func registerProposalMedia(t *testing.T, store *Store, root, scanID, name, kind, title string) {
	t.Helper()
	fixture := "alice.epub"
	metadata := map[string]any{"title": title, "creators": []string{"Author"}}
	if kind == "audio" {
		fixture = "alice-chapter-01.mp3"
		metadata = map[string]any{"tags": map[string]any{"album": title, "artist": "Author"}}
	}

	content, err := os.ReadFile(filepath.Join("..", "..", "..", "test-fixtures", "alice", "pinned", fixture))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, name)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := os.WriteFile(path, content, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.upsertEntry(context.Background(), Scan{ID: scanID, SourceID: "source"}, name,
		kind, info, fmt.Sprintf("%x", sha256.Sum256(content)), metadata)
	if err != nil {
		t.Fatal(err)
	}
}

func onlyProposal(t *testing.T, store *Store) Proposal {
	t.Helper()
	proposals, err := store.Proposals(context.Background(), auth.User{Admin: true}, "library")
	if err != nil || len(proposals) != 1 {
		t.Fatalf("expected one proposal, got %d: %v", len(proposals), err)
	}
	return proposals[0]
}

func TestAcquisitionProposalsSeparateDownloadsButReviewMultiBookPayloads(t *testing.T) {
	for _, separateDownloads := range []bool{false, true} {
		t.Run(fmt.Sprintf("separate_downloads=%v", separateDownloads), func(t *testing.T) {
			ctx := context.Background()
			store, db, root := outcomeFixture(t, "")
			store.maxBytes = 16 << 20

			secondScan, secondTitle := "scan", "Another Book"
			if separateDownloads {
				_, err := db.Exec(`
					INSERT INTO acquisition_requests
					    (id,library_id,requested_by,source_id,query,status,created_at,updated_at)
					VALUES ('other-request','library','user','source','Book','queued','2026-01-01','2026-01-01');
					INSERT INTO source_scans(id,source_id,state,created_at,acquisition_request_id)
					VALUES ('other-scan','source','completed','2026-01-01','other-request')
				`)
				if err != nil {
					t.Fatal(err)
				}
				secondScan, secondTitle = "other-scan", "Book"
			}

			registerProposalMedia(t, store, root, "scan", "first.epub", "epub", "Book")
			registerProposalMedia(t, store, root, secondScan, "second.epub", "epub", secondTitle)
			if err := store.GenerateProposals(ctx, "library"); err != nil {
				t.Fatal(err)
			}
			proposals, err := store.Proposals(ctx, auth.User{Admin: true}, "library")
			if err != nil || len(proposals) != 2 {
				t.Fatalf("proposals=%d err=%v", len(proposals), err)
			}
			for _, proposal := range proposals {
				if len(proposal.Items) != 1 {
					t.Fatalf("mixed payload: %#v", proposal)
				}
			}

			imported, err := store.processAcquisitionImport(ctx, "library", "source", "scan")
			if err != nil {
				t.Fatal(err)
			}
			wantImported, wantState := 0, "needs_review"
			if separateDownloads {
				wantImported, wantState = 1, "accepted"
			}
			var state string
			if err := db.QueryRow(`SELECT state FROM acquisition_import_outcomes WHERE acquisition_request_id='request'`).Scan(&state); err != nil {
				t.Fatal(err)
			}
			if imported != wantImported || state != wantState {
				t.Fatalf("imported=%d state=%q", imported, state)
			}
		})
	}
}

func TestAcquisitionProposalsKeepSameFormatInReview(t *testing.T) {
	ctx := context.Background()
	store, db, root := outcomeFixture(t, "work")
	_, err := db.Exec(`
		INSERT INTO works(id,library_id,title,author,created_at,updated_at)
		VALUES ('work','library','Book','Author','2026-01-01','2026-01-01');
		INSERT INTO representations(id,work_id,kind,label,created_at,updated_at)
		VALUES ('existing','work','audio','Existing narration','2026-01-01','2026-01-01')
	`)
	if err != nil {
		t.Fatal(err)
	}
	linkOutcomeTarget(t, db, "work")
	registerProposalMedia(t, store, root, "scan", "new.mp3", "audio", "Book")
	if err := store.GenerateProposals(ctx, "library"); err != nil {
		t.Fatal(err)
	}
	proposal := onlyProposal(t, store)
	imported, err := store.processAcquisitionImport(ctx, "library", "source", "scan")
	if err != nil || imported != 0 {
		t.Fatalf("imported=%d err=%v", imported, err)
	}
	assertOutcome(t, db, "request", "needs_review", proposal.ID, false)
}
