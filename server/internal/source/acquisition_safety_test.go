package source

import (
	"context"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
)

func TestAcquisitionAutomaticImportSafety(t *testing.T) {
	for _, scenario := range []string{"disabled", "wrong title", "wrong author", "existing wrong title", "existing wrong author", "missing embedded identity", "recovery"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := context.Background()
			store, db, root := outcomeFixture(t, "")
			target := ""
			if scenario == "existing wrong title" || scenario == "existing wrong author" {
				target = "work"
				if _, err := db.Exec(`
					INSERT INTO works(id,library_id,title,author,created_at,updated_at)
					VALUES('work','library','Book','Author','2026-01-01','2026-01-01')
				`); err != nil {
					t.Fatal(err)
				}
			}
			linkOutcomeTarget(t, db, target)
			addOutcomeProposal(t, db, root, "request", "scan", "proposal", "audiobook", "high")
			if _, err := db.Exec(`
				UPDATE library_sources
				SET auto_import=1;
				UPDATE title_requests
				SET author='Author';
				UPDATE source_entries
				SET metadata_json='{"tags":{"album":"Book","artist":"Author"}}'
			`); err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "disabled":
				if _, err := db.Exec(`UPDATE library_sources SET auto_import=0`); err != nil {
					t.Fatal(err)
				}
			case "wrong title", "existing wrong title":
				if _, err := db.Exec(`
					UPDATE source_entries
					SET metadata_json='{"tags":{"album":"Wrong Book","artist":"Author"}}';
					UPDATE import_groups
					SET proposed_title='Wrong Book'
				`); err != nil {
					t.Fatal(err)
				}
			case "wrong author", "existing wrong author":
				if _, err := db.Exec(`
					UPDATE source_entries
					SET metadata_json='{"tags":{"album":"Book","artist":"Wrong Author"}}';
					UPDATE import_groups
					SET proposed_author='Wrong Author'
				`); err != nil {
					t.Fatal(err)
				}
			case "missing embedded identity":
				if _, err := db.Exec(`UPDATE source_entries SET metadata_json='{}'`); err != nil {
					t.Fatal(err)
				}
			}
			imported, err := store.processAcquisitionImport(ctx, "library", "source", "scan")
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "recovery" {
				if imported != 1 {
					t.Fatalf("imported=%d", imported)
				}
				var acceptedWork string
				if err := db.QueryRow(`
					SELECT accepted_work_id
					FROM acquisition_import_outcomes
					WHERE acquisition_request_id='request'
					AND scan_id='scan'
					AND proposal_id='proposal'
					AND state='accepted'
				`).Scan(&acceptedWork); err != nil {
					t.Fatal(err)
				}
				if _, err := db.Exec(`UPDATE source_scans SET state='scanning'`); err != nil {
					t.Fatal(err)
				}
				if err := store.recoverScans(ctx); err != nil {
					t.Fatal(err)
				}
				if _, err := store.processAcquisitionImport(ctx, "library", "source", "scan"); err != nil {
					t.Fatal(err)
				}
				if err := store.failAcquisitionOutcome(ctx, "scan", "late error"); err != nil {
					t.Fatal(err)
				}
				assertOutcome(t, db, "request", "accepted", "proposal", true)
				var replayWork string
				if err := db.QueryRow(`
					SELECT accepted_work_id
					FROM acquisition_import_outcomes
					WHERE acquisition_request_id='request'
					AND scan_id='scan'
					AND proposal_id='proposal'
				`).Scan(&replayWork); err != nil || replayWork != acceptedWork {
					t.Fatalf("replay work=%q want=%q err=%v", replayWork, acceptedWork, err)
				}
				var works, reps int
				if err := db.QueryRow(`SELECT (SELECT COUNT(*) FROM works), (SELECT COUNT(*) FROM representations)`).Scan(&works, &reps); err != nil || works != 1 || reps != 1 {
					t.Fatalf("works=%d reps=%d err=%v", works, reps, err)
				}
				var media int
				if err := db.QueryRow(`SELECT COUNT(*) FROM media`).Scan(&media); err != nil || media != 1 {
					t.Fatalf("media=%d err=%v", media, err)
				}
				return
			}
			if imported != 0 {
				t.Fatalf("unsafe automatic import=%d", imported)
			}
			assertOutcome(t, db, "request", "needs_review", "proposal", false)
			if count, err := store.autoImportProposals(ctx, "library", "source", "scan"); err != nil || count != 0 {
				t.Fatalf("ordinary import bypass=%d err=%v", count, err)
			}
			if scenario == "disabled" {
				_, err := store.AcceptProposal(ctx, auth.User{Admin: true}, "library", "proposal", AcceptRequest{
					ExpectedRevision: 1,
					Title:            "Book",
					Author:           "Author",
					Items:            []AcceptItem{{SourceEntryID: "proposal-entry", Kind: "audiobook", Label: "Audio"}},
				})
				if err != nil {
					t.Fatal(err)
				}
				assertOutcome(t, db, "request", "accepted", "proposal", true)
			}
		})
	}
}

func TestAcquisitionAcceptanceCommitsOutcomeAtomically(t *testing.T) {
	ctx := context.Background()
	store, db, root := outcomeFixture(t, "")
	addOutcomeProposal(t, db, root, "request", "scan", "proposal", "epub", "high")
	// A failed outcome write must roll back the accepted proposal and catalog too.
	if _, err := db.Exec(`
		CREATE TRIGGER reject_outcome BEFORE UPDATE ON acquisition_import_outcomes
		WHEN NEW.state='accepted'
		BEGIN SELECT RAISE(ABORT,'test outcome failure');
		END
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.processAcquisitionImport(ctx, "library", "source", "scan"); err == nil {
		t.Fatal("expected outcome failure")
	}
	var works, media int
	var decision string
	if err := db.QueryRow(`
		SELECT (SELECT COUNT(*) FROM works),
               (SELECT COUNT(*) FROM media),
               decision
		FROM import_groups
		WHERE id='proposal'
	`).Scan(&works, &media, &decision); err != nil || works != 0 || media != 0 || decision != "" {
		t.Fatalf("works=%d media=%d decision=%q err=%v", works, media, decision, err)
	}
	assertOutcome(t, db, "request", "needs_review", "proposal", false)
	if _, err := db.Exec(`DROP TRIGGER reject_outcome`); err != nil {
		t.Fatal(err)
	}
	if count, err := store.processAcquisitionImport(ctx, "library", "source", "scan"); err != nil || count != 1 {
		t.Fatalf("retry=%d err=%v", count, err)
	}
	assertOutcome(t, db, "request", "accepted", "proposal", true)
}

func TestAcquisitionDifferentScanCannotReplaceOutcome(t *testing.T) {
	ctx := context.Background()
	store, db, _ := outcomeFixture(t, "")
	if _, err := db.Exec(`
		INSERT INTO source_scans(id,source_id,state,created_at)
		VALUES('other-scan','source','completed','2026-02-01')
	`); err != nil {
		t.Fatal(err)
	}
	for _, state := range []string{"pending", "failed", "needs_review"} {
		if err := store.saveAcquisitionOutcome(ctx, "request", "other-scan", state, "", "", "stale"); err != nil {
			t.Fatal(err)
		}
	}
	var scan, state string
	if err := db.QueryRow(`
		SELECT scan_id, state
		FROM acquisition_import_outcomes
		WHERE acquisition_request_id='request'
	`).Scan(&scan, &state); err != nil || scan != "scan" || state != "pending" {
		t.Fatalf("scan=%q state=%q err=%v", scan, state, err)
	}
}

func TestOrdinaryScanDoesNotImportAcquisitionReview(t *testing.T) {
	ctx := context.Background()
	store, db, root := outcomeFixture(t, "")
	addOutcomeProposal(t, db, root, "request", "scan", "proposal", "epub", "high")
	if _, err := db.Exec(`
		INSERT INTO source_scans(id,source_id,state,created_at)
		VALUES('ordinary','source','completed','2026-02-01');
		UPDATE source_entries
		SET acquisition_scan_id='scan',last_seen_scan_id='ordinary'
	`); err != nil {
		t.Fatal(err)
	}
	if count, err := store.autoImportProposals(ctx, "library", "source", "ordinary"); err != nil || count != 0 {
		t.Fatalf("ordinary bypass=%d err=%v", count, err)
	}
}
