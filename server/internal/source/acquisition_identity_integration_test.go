package source

import (
	"context"
	"encoding/json"
	"testing"
)

func TestAcquisitionEmbeddedIdentityGate(t *testing.T) {
	for _, tt := range []struct {
		name, album, title, author string
		wantImport                 bool
	}{
		{"exact recorded metadata", "Sunrise on the Reaping (Unabridged)", "Sunrise on the Reaping", "Suzanne Collins", true},
		{"chapter title with matching album", "Sunrise on the Reaping", "Chapter 1", "Suzanne Collins", true},
		{"chapter cannot corroborate suffix", "Sunrise on the Reaping (Unabridged)", "Chapter 1", "Suzanne Collins", false},
		{"different book", "Catching Fire", "Sunrise on the Reaping", "Suzanne Collins", false},
		{"different author", "Sunrise on the Reaping (Unabridged)", "Sunrise on the Reaping", "Other Author", false},
		{"abridged", "Sunrise on the Reaping (Abridged)", "Sunrise on the Reaping", "Suzanne Collins", false},
		{"different edition", "Sunrise on the Reaping (Revised Edition)", "Sunrise on the Reaping", "Suzanne Collins", false},
		{"missing identity", "", "", "", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ctx := context.Background()
			store, db, root := outcomeFixture(t, "")
			linkOutcomeTarget(t, db, "")
			addOutcomeProposal(t, db, root, "request", "scan", "proposal", "audiobook", "high")
			metadata, _ := json.Marshal(map[string]any{"duration_ms": 46112251, "tags": map[string]any{
				"album": tt.album, "title": tt.title, "artist": tt.author, "album_artist": tt.author,
				"composer": "Jefferson White", "date": "2025",
			}})
			if _, err := db.Exec(`UPDATE title_requests SET title='Sunrise on the Reaping',author='Suzanne Collins';
				UPDATE library_sources SET auto_import=1;
				UPDATE source_entries SET metadata_json=?,acquisition_scan_id='scan' WHERE id='proposal-entry'`, string(metadata)); err != nil {
				t.Fatal(err)
			}
			imported, err := store.processAcquisitionImport(ctx, "library", "source", "scan")
			want := 0
			if tt.wantImport {
				want = 1
			}
			if err != nil || imported != want {
				t.Fatalf("imported=%d want=%d err=%v", imported, want, err)
			}
			if tt.wantImport {
				assertOutcome(t, db, "request", "accepted", "proposal", true)
				return
			}
			assertOutcome(t, db, "request", "needs_review", "proposal", false)
			var reason string
			if err := db.QueryRow(`SELECT reason FROM acquisition_import_outcomes WHERE acquisition_request_id='request'`).Scan(&reason); err != nil || reason != "The downloaded book's embedded title or author does not confirm the requested book. Review the files before importing." {
				t.Fatalf("reason=%q err=%v", reason, err)
			}
			// Neither the same scan's generic auto-import pass nor a later ordinary
			// scan may bypass an acquisition-specific review decision.
			for _, scanID := range []string{"scan", "ordinary"} {
				if scanID == "ordinary" {
					if _, err := db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at) VALUES('ordinary','source','completed','2026-01-02'); UPDATE source_entries SET last_seen_scan_id='ordinary' WHERE id='proposal-entry'`); err != nil {
						t.Fatal(err)
					}
				}
				if n, err := store.autoImportProposals(ctx, "library", "source", scanID); err != nil || n != 0 {
					t.Fatalf("generic scan %s imported=%d err=%v", scanID, n, err)
				}
			}
			assertOutcome(t, db, "request", "needs_review", "proposal", false)
		})
	}
}

func TestAcquisitionIdentityPreservesExplicitRequestedEdition(t *testing.T) {
	store, db, root := outcomeFixture(t, "")
	addOutcomeProposal(t, db, root, "request", "scan", "proposal", "audiobook", "high")
	metadata := `{"tags":{"album":"Sunrise on the Reaping (Unabridged)","title":"Sunrise on the Reaping","album_artist":"Suzanne Collins","artist":"Suzanne Collins"}}`
	if _, err := db.Exec(`UPDATE source_entries SET metadata_json=?`, metadata); err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		title string
		want  bool
	}{
		{"Sunrise on the Reaping (Unabridged)", true},
		{"Sunrise on the Reaping", true},
		{"Sunrise on the Reaping (Abridged)", false},
		{"Sunrise on the Reaping (Revised Edition)", false},
	} {
		got, err := store.acquisitionIdentityMatches(context.Background(), "proposal", tt.title, "Suzanne Collins")
		if err != nil || got != tt.want {
			t.Fatalf("%s: matches=%v want=%v err=%v", tt.title, got, tt.want, err)
		}
	}
}
