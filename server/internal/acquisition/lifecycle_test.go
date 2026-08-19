package acquisition

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestRequestLifecycleFromSearchToAvailableWork(t *testing.T) {
	ctx := context.Background()
	var downloadTag string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/indexer":
			_, _ = w.Write([]byte(`<rss><channel><item><title>Alice EPUB</title><enclosure url="https://download.test/alice" length="123"/></item></channel></rss>`))
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/add":
			if err := r.ParseMultipartForm(1024); err != nil {
				t.Fatal(err)
			}
			downloadTag = r.FormValue("tags")
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/info":
			_, _ = w.Write([]byte(`[{"hash":"hash","name":"Alice","state":"uploading","content_path":"/downloads/Alice","tags":"` + downloadTag + `","progress":1,"size":123}]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	root := t.TempDir()
	db, err := database.Open(ctx, filepath.Join(root, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at)
		VALUES('reader','reader','reader','Reader','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO libraries(id,name,created_at,updated_at)
		VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO library_members(library_id,user_id,role,can_request_acquisitions,created_at)
		VALUES('library','reader','reader',1,'2026-01-01T00:00:00Z');
		INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at)
		VALUES('source','library','local','Downloads',?,1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`, root); err != nil {
		t.Fatal(err)
	}

	client, err := New(Options{
		IndexerURL:   server.URL + "/indexer",
		QBitURL:      server.URL,
		DownloadRoot: "/downloads",
	})
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(db, client)
	store.SetHandoff(func(_ context.Context, libraryID, sourceID, requestID, completedPath string) (string, error) {
		if libraryID != "library" || sourceID != "source" || completedPath != filepath.Join(root, "Alice") {
			t.Fatalf("handoff = %q %q %q", libraryID, sourceID, completedPath)
		}
		_, err := db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at,acquisition_request_id) VALUES('scan',?,'pending','2026-01-01T00:00:00Z',?)`, sourceID, requestID)
		return "scan", err
	})

	reader := auth.User{ID: "reader"}
	request, err := store.Create(ctx, reader, "library", "source", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	results, err := store.Search(ctx, reader, "library", request.ID)
	if err != nil || len(results) != 1 {
		t.Fatalf("search results=%#v err=%v", results, err)
	}
	request, err = store.Select(ctx, reader, "library", request.ID, results[0].ID)
	if err != nil || request.FulfillmentState != "downloading" || downloadTag != request.ID {
		t.Fatalf("selected request=%#v tag=%q err=%v", request, downloadTag, err)
	}
	if err := store.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	assertAcquisitionState(t, db, request.ID, "scanning", "")

	if _, err := db.Exec(`
		UPDATE source_scans SET state='completed',finished_at='2026-01-01T00:01:00Z' WHERE id='scan';
		INSERT INTO source_entries(id,source_id,relative_path,size_bytes,modified_at,sha256,state,created_at,updated_at,detected_kind,last_seen_scan_id)
		VALUES('entry','source','Alice/book.epub',123,'2026-01-01T00:00:00Z','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','registered','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','epub','scan');
		INSERT INTO import_groups(id,library_id,logical_key,content_key,state,confidence,proposed_title,normalized_title,normalized_author,reasons_json,revision,created_at,updated_at)
		VALUES('proposal','library','logical','content','proposed','high','Alice','alice','','[]',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO import_items(group_id,source_entry_id,representation_kind,proposed_label,evidence_json)
		VALUES('proposal','entry','epub','EPUB','{}');
		INSERT INTO acquisition_import_outcomes(acquisition_request_id,scan_id,state,proposal_id,reason,updated_at) VALUES(?,'scan','needs_review','proposal','Review required.','2026-01-01T00:01:00Z')`, request.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	assertAcquisitionState(t, db, request.ID, "needs_review", "proposal")

	if _, err := db.Exec(`
		INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('work','library','Alice','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		UPDATE import_groups SET decision='accepted',accepted_work_id='work',state='obsolete' WHERE id='proposal';
		UPDATE acquisition_import_outcomes SET state='accepted',accepted_work_id='work',reason='' WHERE acquisition_request_id=?`, request.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	assertAcquisitionState(t, db, request.ID, "available", "work")

	var status string
	if err := db.QueryRow(`SELECT status FROM user_work_statuses WHERE user_id='reader' AND work_id='work'`).Scan(&status); err != nil || status != "want_to_read" {
		t.Fatalf("reader status=%q err=%v", status, err)
	}
}

func assertAcquisitionState(t *testing.T, db *sql.DB, requestID, wantState, wantLink string) {
	t.Helper()
	var state, proposalID, workID string
	if err := db.QueryRow(`SELECT fulfillment_state,COALESCE(proposal_id,''),COALESCE(work_id,'') FROM acquisition_requests WHERE id=?`, requestID).Scan(&state, &proposalID, &workID); err != nil {
		t.Fatal(err)
	}
	if state != wantState || (wantState == "needs_review" && proposalID != wantLink) || (wantState == "available" && workID != wantLink) {
		t.Fatalf("state=%q proposal=%q work=%q", state, proposalID, workID)
	}
}
