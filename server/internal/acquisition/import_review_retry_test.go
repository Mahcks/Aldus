package acquisition

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/source"
)

func TestExistingImportReviewRequiresLinkedScanRetry(t *testing.T) {
	db := titleLifecycleFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	root, data := t.TempDir(), t.TempDir()
	path := filepath.Join(root, "sunrise.m4b")
	cmd := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "0.1", "-c:a", "aac",
		"-metadata", "title=Sunrise on the Reaping", "-metadata", "album=Sunrise on the Reaping (Unabridged)",
		"-metadata", "artist=Suzanne Collins", "-metadata", "album_artist=Suzanne Collins", "-metadata", "composer=Jefferson White", "-metadata", "date=2025", path)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("create audio fixture: %v: %s", err, output)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	metadata, _ := json.Marshal(map[string]any{"duration_ms": 100, "tags": map[string]any{"title": "Sunrise on the Reaping", "album": "Sunrise on the Reaping (Unabridged)", "artist": "Suzanne Collins", "album_artist": "Suzanne Collins", "composer": "Jefferson White", "date": "2025"}})
	if _, err := db.Exec(`UPDATE library_sources SET root_path=?1,auto_import=1 WHERE id='source';
		UPDATE title_requests SET title='Sunrise on the Reaping',author='Suzanne Collins';
		UPDATE title_request_formats SET format='audiobook',state='needs_review';
		INSERT INTO source_scans(id,source_id,state,created_at,acquisition_request_id) VALUES('linked','source','completed','2026-01-01','legacy');
		UPDATE acquisition_requests SET fulfillment_state='needs_review',download_state='ready',scan_id='linked',completed_relative_path='sunrise.m4b';
		INSERT INTO source_entries(id,source_id,relative_path,size_bytes,modified_at,sha256,state,created_at,updated_at,detected_kind,metadata_json,last_seen_scan_id,acquisition_scan_id)
		VALUES('entry','source','sunrise.m4b',?2,?3,?4,'registered','2026-01-01','2026-01-01','audio',?5,'linked','linked')`, root, len(content), info.ModTime().UTC().Format(time.RFC3339Nano), fmt.Sprintf("%x", sha256.Sum256(content)), string(metadata)); err != nil {
		t.Fatal(err)
	}
	sources, err := source.New(db, source.Options{AllowedRoots: []string{root}, DataRoot: data, ManagedRoot: filepath.Join(data, "managed"), MaxBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	if err := sources.GenerateProposals(ctx, "library"); err != nil {
		t.Fatal(err)
	}
	proposals, err := sources.Proposals(ctx, auth.User{Admin: true}, "library")
	if err != nil || len(proposals) != 1 {
		t.Fatalf("proposals=%+v err=%v", proposals, err)
	}
	const reason = "The downloaded book's embedded title or author does not confirm the requested book. Review the files before importing."
	if _, err := db.Exec(`INSERT INTO acquisition_import_outcomes(acquisition_request_id,scan_id,state,proposal_id,reason,updated_at) VALUES('legacy','linked','needs_review',?1,?2,'2026-01-01'); UPDATE acquisition_requests SET proposal_id=?1,download_error=?2 WHERE id='legacy'`, proposals[0].ID, reason); err != nil {
		t.Fatal(err)
	}
	legacy := NewStore(db, nil) // No download client: retries must use the stored payload.
	legacy.SetScanRetry(sources.RetryAcquisitionScan)
	titles := NewTitleRequestStore(db)
	if err := sources.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer func() { cancel(); sources.Wait() }()
	if err := legacy.reconcileFulfillment(ctx); err != nil {
		t.Fatal(err)
	}
	assertHeldImport(t, db)
	// An ordinary source rescan must not bypass the acquisition outcome.
	ordinary, err := sources.EnqueueScan(ctx, auth.User{ID: "reader"}, "library", "source")
	if err != nil {
		t.Fatal(err)
	}
	waitReviewScan(t, db, ordinary.ID)
	assertHeldImport(t, db)
	if err := legacy.Retry(ctx, auth.User{ID: "reader"}, "library", "legacy"); err != nil {
		t.Fatalf("retry stored acquisition scan: %v", err)
	}
	waitReviewScan(t, db, "linked")
	if err := legacy.reconcileFulfillment(ctx); err != nil {
		t.Fatal(err)
	}
	if err := titles.syncLegacyFulfillment(ctx); err != nil {
		t.Fatal(err)
	}
	var requestState, formatState, outcome string
	var works, media int
	if err := db.QueryRow(`SELECT a.fulfillment_state,f.state,o.state,(SELECT COUNT(*) FROM works),(SELECT COUNT(*) FROM media WHERE kind='audio') FROM acquisition_requests a JOIN title_request_formats f ON f.legacy_acquisition_request_id=a.id JOIN acquisition_import_outcomes o ON o.acquisition_request_id=a.id WHERE a.id='legacy'`).Scan(&requestState, &formatState, &outcome, &works, &media); err != nil {
		t.Fatal(err)
	}
	if requestState != "available" || formatState != "available" || outcome != "accepted" || works != 1 || media != 1 {
		t.Fatalf("request=%s format=%s outcome=%s works=%d media=%d", requestState, formatState, outcome, works, media)
	}
}

func assertHeldImport(t *testing.T, db *sql.DB) {
	t.Helper()
	var state, outcome, scan string
	var works int
	if err := db.QueryRow(`SELECT a.fulfillment_state,o.state,sc.state,(SELECT COUNT(*) FROM works) FROM acquisition_requests a JOIN acquisition_import_outcomes o ON o.acquisition_request_id=a.id JOIN source_scans sc ON sc.id=o.scan_id WHERE a.id='legacy'`).Scan(&state, &outcome, &scan, &works); err != nil {
		t.Fatal(err)
	}
	if state != "needs_review" || outcome != "needs_review" || scan != "completed" || works != 0 {
		t.Fatalf("held request changed: request=%s outcome=%s scan=%s works=%d", state, outcome, scan, works)
	}
}

func waitReviewScan(t *testing.T, db *sql.DB, scanID string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	for {
		var state, message string
		if err := db.QueryRow(`SELECT state,error_summary FROM source_scans WHERE id=?`, scanID).Scan(&state, &message); err != nil {
			t.Fatal(err)
		}
		if state == "completed" {
			return
		}
		if state == "failed" {
			t.Fatalf("scan %s failed: %s", scanID, message)
		}
		select {
		case <-ctx.Done():
			t.Fatalf("scan %s did not finish", scanID)
		case <-ticker.C:
		}
	}
}

func TestImportReviewRetryRejectsUnownedOrResolvedScan(t *testing.T) {
	for _, tt := range []struct {
		name, change string
		actor        auth.User
		want         error
	}{
		{"canceled", "UPDATE title_request_formats SET state='canceled'", auth.User{ID: "reader"}, ErrInvalid},
		{"denied", "UPDATE title_request_formats SET state='denied'", auth.User{ID: "reader"}, ErrInvalid},
		{"available", "UPDATE title_request_formats SET state='available'", auth.User{ID: "reader"}, ErrInvalid},
		{"accepted outcome", "UPDATE acquisition_import_outcomes SET state='accepted'", auth.User{ID: "reader"}, ErrInvalid},
		{"missing scan", "UPDATE acquisition_requests SET scan_id=NULL", auth.User{ID: "reader"}, ErrInvalid},
		{"unlinked scan", "UPDATE source_scans SET acquisition_request_id=NULL", auth.User{ID: "reader"}, ErrInvalid},
		{"running scan", "UPDATE source_scans SET state='scanning'", auth.User{ID: "reader"}, ErrInvalid},
		{"unauthorized", "", auth.User{ID: "outsider"}, ErrNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			db := titleLifecycleFixture(t)
			_, err := db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at,acquisition_request_id) VALUES('linked','source','completed','2026-01-01','legacy');
   UPDATE acquisition_requests SET fulfillment_state='needs_review',scan_id='linked';
   UPDATE title_request_formats SET state='needs_review';
   INSERT INTO acquisition_import_outcomes(acquisition_request_id,scan_id,state,reason,updated_at) VALUES('legacy','linked','needs_review','held','2026-01-01');`)
			if err != nil {
				t.Fatal(err)
			}
			if tt.change != "" {
				if _, err := db.Exec(tt.change); err != nil {
					t.Fatal(err)
				}
			}
			store := NewStore(db, nil)
			store.SetScanRetry(func(context.Context, string, string) error {
				t.Fatal("rejected retry reached source worker")
				return nil
			})
			if err := store.Retry(context.Background(), tt.actor, "library", "legacy"); !errors.Is(err, tt.want) {
				t.Fatalf("got %v want %v", err, tt.want)
			}
			var state string
			if err := db.QueryRow(`SELECT fulfillment_state FROM acquisition_requests WHERE id='legacy'`).Scan(&state); err != nil || state != "needs_review" {
				t.Fatalf("state=%s err=%v", state, err)
			}
		})
	}
}
