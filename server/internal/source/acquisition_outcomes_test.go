package source

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/database"
)

func TestAcquisitionImportOutcomes(t *testing.T) {
	t.Run("new work auto import", func(t *testing.T) {
		store, db, root := outcomeFixture(t, "")
		addOutcomeProposal(t, db, root, "request", "scan", "proposal", "epub", "high")
		imported, err := store.processAcquisitionImport(context.Background(), "library", "source", "scan")
		if err != nil || imported != 1 {
			t.Fatalf("imported=%d err=%v", imported, err)
		}
		assertOutcome(t, db, "request", "accepted", "proposal", true)
	})

	t.Run("missing audiobook attaches to existing ebook", func(t *testing.T) {
		store, db, root := outcomeFixture(t, "work")
		if _, err := db.Exec(`INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('work','library','Book','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO representations(id,work_id,kind,label,created_at,updated_at) VALUES('epub-rep','work','epub','EPUB','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`); err != nil {
			t.Fatal(err)
		}
		linkOutcomeTarget(t, db, "work")
		addOutcomeProposal(t, db, root, "request", "scan", "proposal", "audiobook", "high")
		imported, err := store.processAcquisitionImport(context.Background(), "library", "source", "scan")
		if err != nil || imported != 1 {
			t.Fatalf("imported=%d err=%v", imported, err)
		}
		var audio int
		if err := db.QueryRow(`SELECT COUNT(*) FROM representations WHERE work_id='work' AND kind='audio'`).Scan(&audio); err != nil || audio != 1 {
			t.Fatalf("audio representations=%d err=%v", audio, err)
		}
		assertOutcome(t, db, "request", "accepted", "proposal", true)
	})

	t.Run("same kind edition requires review", func(t *testing.T) {
		store, db, root := outcomeFixture(t, "work")
		if _, err := db.Exec(`INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('work','library','Book','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO representations(id,work_id,kind,label,created_at,updated_at) VALUES('epub-rep','work','epub','EPUB','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`); err != nil {
			t.Fatal(err)
		}
		linkOutcomeTarget(t, db, "work")
		addOutcomeProposal(t, db, root, "request", "scan", "proposal", "epub", "high")
		imported, err := store.processAcquisitionImport(context.Background(), "library", "source", "scan")
		if err != nil || imported != 0 {
			t.Fatalf("imported=%d err=%v", imported, err)
		}
		assertOutcome(t, db, "request", "needs_review", "proposal", false)
	})

	t.Run("empty scan records failure", func(t *testing.T) {
		store, db, _ := outcomeFixture(t, "")
		imported, err := store.processAcquisitionImport(context.Background(), "library", "source", "scan")
		if err != nil || imported != 0 {
			t.Fatalf("imported=%d err=%v", imported, err)
		}
		assertOutcome(t, db, "request", "failed", "", false)
	})

	t.Run("target work cannot cross libraries", func(t *testing.T) {
		store, db, root := outcomeFixture(t, "foreign-work")
		if _, err := db.Exec(`INSERT INTO libraries(id,name,created_at,updated_at) VALUES('other-library','Other','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('foreign-work','other-library','Book','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`); err != nil {
			t.Fatal(err)
		}
		linkOutcomeTarget(t, db, "foreign-work")
		addOutcomeProposal(t, db, root, "request", "scan", "proposal", "audiobook", "high")
		imported, err := store.processAcquisitionImport(context.Background(), "library", "source", "scan")
		if err != nil || imported != 0 {
			t.Fatalf("imported=%d err=%v", imported, err)
		}
		var attached int
		if err := db.QueryRow(`SELECT COUNT(*) FROM representations WHERE work_id='foreign-work'`).Scan(&attached); err != nil || attached != 0 {
			t.Fatalf("foreign attachments=%d err=%v", attached, err)
		}
		assertOutcome(t, db, "request", "failed", "proposal", false)
	})
}

func outcomeFixture(t *testing.T, _ string) (*Store, *sql.DB, string) {
	t.Helper()
	ctx := context.Background()
	base := t.TempDir()
	root := filepath.Join(base, "source")
	dataRoot := filepath.Join(base, "data")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dataRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	db, err := database.Open(ctx, filepath.Join(dataRoot, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	var exists bool
	if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='acquisition_import_outcomes')`).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if !exists {
		schema, err := os.ReadFile("../database/migrations/032_acquisition_import_outcomes.sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(string(schema)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('user','user','user','User','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('source','library','local','Source',?,1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,download_state,fulfillment_state,created_at,updated_at) VALUES('request','library','user','source','Book','queued','ready','scanning','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO source_scans(id,source_id,state,created_at,acquisition_request_id) VALUES('scan','source','completed','2026-01-01T00:00:00Z','request'); INSERT INTO acquisition_import_outcomes(acquisition_request_id,scan_id,state,updated_at) VALUES('request','scan','pending','2026-01-01T00:00:00Z')`, root); err != nil {
		t.Fatal(err)
	}
	store, err := New(db, Options{AllowedRoots: []string{root}, ManagedRoot: filepath.Join(base, "managed"), DataRoot: dataRoot, MaxBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	return store, db, root
}

func linkOutcomeTarget(t *testing.T, db *sql.DB, workID string) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO title_requests(id,library_id,requested_by,work_id,title,created_at,updated_at) VALUES('title-request','library','user',?,'Book','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO title_request_formats(title_request_id,format,state,legacy_acquisition_request_id,created_at,updated_at) VALUES('title-request','audiobook','scanning','request','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`, workID); err != nil {
		t.Fatal(err)
	}
}

func addOutcomeProposal(t *testing.T, db *sql.DB, root, _, scanID, proposalID, kind, confidence string) {
	t.Helper()
	name := "book.epub"
	detected := "epub"
	if kind == "audiobook" {
		name, detected = "book.mp3", "audio"
	}
	content := []byte("valid immutable test media")
	path := filepath.Join(root, name)
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(content))
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Exec(`INSERT INTO source_entries(id,source_id,relative_path,size_bytes,modified_at,sha256,state,created_at,updated_at,detected_kind,metadata_json,last_seen_scan_id) VALUES('entry','source',?,?,?,?,'registered',?,?,?,'{}',?)`, name, len(content), info.ModTime().UTC().Format(time.RFC3339Nano), hash, now, now, detected, scanID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO import_groups(id,library_id,logical_key,content_key,state,confidence,proposed_title,proposed_author,normalized_title,normalized_author,reasons_json,revision,created_at,updated_at) VALUES(?,'library','logical','content','proposed',?,'Book','Author','book','author','[]',1,?,?)`, proposalID, confidence, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO import_items(group_id,source_entry_id,representation_kind,proposed_label,evidence_json) VALUES(?,'entry',?,'Imported','{}')`, proposalID, kind); err != nil {
		t.Fatal(err)
	}
}

func assertOutcome(t *testing.T, db *sql.DB, requestID, state, proposalID string, wantWork bool) {
	t.Helper()
	var gotState, gotProposal, workID, reason string
	if err := db.QueryRow(`SELECT state,COALESCE(proposal_id,''),COALESCE(accepted_work_id,''),reason FROM acquisition_import_outcomes WHERE acquisition_request_id=?`, requestID).Scan(&gotState, &gotProposal, &workID, &reason); err != nil {
		t.Fatal(err)
	}
	if gotState != state || gotProposal != proposalID || (wantWork && workID == "") || (!wantWork && workID != "") || (state == "failed" && reason == "") {
		t.Fatalf("outcome state=%q proposal=%q work=%q reason=%q", gotState, gotProposal, workID, reason)
	}
}
