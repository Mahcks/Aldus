package acquisition

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestRequestsAndResultsStayInsideTheirLibrary(t *testing.T) {
	ctx := context.Background()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/indexer":
			_, _ = w.Write([]byte(`<rss><channel><item><title>Book EPUB</title><enclosure url="https://download.test/book"/></item></channel></rss>`))
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/categories":
			_, _ = w.Write([]byte(`{"aldus":{}}`))
		case "/api/v2/torrents/add":
			_, _ = w.Write([]byte("Ok."))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES
			('editor','editor','editor','Editor','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES
			('one','One','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
			('two','Two','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO library_members(library_id,user_id,role,created_at) VALUES
			('one','editor','editor','2026-01-01T00:00:00Z'),
			('two','editor','editor','2026-01-01T00:00:00Z');
		INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES
			('source-one','one','local','One','/one',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
			('source-two','two','local','Two','/two',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	client, _ := New(Options{IndexerURL: server.URL + "/indexer", QBitURL: server.URL, Category: "aldus"})
	store := NewStore(db, client)
	editor := auth.User{ID: "editor"}
	requestOne, err := store.Create(ctx, editor, "one", "source-one", "Book one")
	if err != nil {
		t.Fatal(err)
	}
	requestTwo, err := store.Create(ctx, editor, "two", "source-two", "Book two")
	if err != nil {
		t.Fatal(err)
	}
	resultsOne, err := store.Search(ctx, editor, "one", requestOne.ID)
	if err != nil || len(resultsOne) != 1 {
		t.Fatalf("search one = %#v, %v", resultsOne, err)
	}
	resultsTwo, err := store.Search(ctx, editor, "two", requestTwo.ID)
	if err != nil || len(resultsTwo) != 1 {
		t.Fatalf("search two = %#v, %v", resultsTwo, err)
	}
	if _, err := store.Search(ctx, editor, "two", requestOne.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-library request search error = %v", err)
	}
	if _, err := store.Select(ctx, editor, "one", requestOne.ID, resultsTwo[0].ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-request result selection error = %v", err)
	}
	listed, err := store.List(ctx, editor, "one")
	if err != nil || len(listed) != 1 || listed[0].ID != requestOne.ID {
		t.Fatalf("library one list = %#v, %v", listed, err)
	}
}

func TestPollResumesHandoffCreatedBeforeRequestStateWasSaved(t *testing.T) {
	ctx := context.Background()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/info":
			_, _ = w.Write([]byte(`[{"state":"uploading","content_path":"/downloads/Book","tags":"request","progress":1}]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('source','library','local','Downloads','/library/downloads',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,download_state,fulfillment_state,created_at,updated_at) VALUES('request','library','admin','source','Book','queued','downloading','downloading','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO source_scans(id,source_id,state,created_at,acquisition_request_id) VALUES('existing-scan','source','pending','2026-01-01T00:00:00Z','request')`)
	if err != nil {
		t.Fatal(err)
	}
	client, _ := New(Options{QBitURL: server.URL, DownloadRoot: "/downloads"})
	store := NewStore(db, client)
	handoffs := 0
	store.SetHandoff(func(_ context.Context, _, _, requestID, _ string) (string, error) {
		handoffs++
		if requestID != "request" {
			t.Fatalf("request ID = %q", requestID)
		}
		return "existing-scan", nil
	})
	if err := store.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	var state, scanID string
	if err := db.QueryRow(`SELECT fulfillment_state,COALESCE(scan_id,'') FROM acquisition_requests WHERE id='request'`).Scan(&state, &scanID); err != nil || state != "scanning" || scanID != "existing-scan" || handoffs != 1 {
		t.Fatalf("state=%q scan=%q handoffs=%d err=%v", state, scanID, handoffs, err)
	}
}

func TestPollRecoversSubmissionAlreadyAcceptedByQBitTorrent(t *testing.T) {
	ctx := context.Background()
	addCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/info":
			_, _ = w.Write([]byte(`[{"state":"downloading","content_path":"/downloads/Book","tags":"request","progress":0.5}]`))
		case "/api/v2/torrents/add":
			addCalls++
			_, _ = w.Write([]byte("Ok."))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('source','library','local','Downloads','/library/downloads',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,download_state,fulfillment_state,selected_url,created_at,updated_at) VALUES('request','library','admin','source','Book','requested','','submitting','https://download.test/book','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	client, _ := New(Options{QBitURL: server.URL, DownloadRoot: "/downloads"})
	store := NewStore(db, client)
	store.SetHandoff(func(context.Context, string, string, string, string) (string, error) {
		t.Fatal("incomplete download must not start a scan")
		return "", nil
	})
	if err := store.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	var status, downloadState, fulfillmentState string
	if err := db.QueryRow(`SELECT status,download_state,fulfillment_state FROM acquisition_requests WHERE id='request'`).Scan(&status, &downloadState, &fulfillmentState); err != nil || status != "queued" || downloadState != "downloading" || fulfillmentState != "downloading" || addCalls != 0 {
		t.Fatalf("status=%q download=%q fulfillment=%q add calls=%d err=%v", status, downloadState, fulfillmentState, addCalls, err)
	}
}

func TestFulfillmentRejectsCrossLibraryProposalAndWorkLinks(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES
			('one','One','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
			('two','Two','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('work-two','two','Book','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO import_groups(id,library_id,logical_key,content_key,state,confidence,proposed_title,normalized_title,normalized_author,reasons_json,revision,decision,accepted_work_id,created_at,updated_at) VALUES('proposal-two','two','logical','content','obsolete','high','Book','book','','[]',1,'accepted','work-two','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO acquisition_requests(id,library_id,requested_by,query,status,download_state,fulfillment_state,proposal_id,created_at,updated_at) VALUES('request-one','one','admin','Book','queued','ready','needs_review','proposal-two','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(db, &Client{})
	if err := store.reconcileFulfillment(ctx); err != nil {
		t.Fatal(err)
	}
	var state, workID string
	if err := db.QueryRow(`SELECT fulfillment_state,COALESCE(work_id,'') FROM acquisition_requests WHERE id='request-one'`).Scan(&state, &workID); err != nil || state != "needs_review" || workID != "" {
		t.Fatalf("state=%q work=%q err=%v", state, workID, err)
	}
}
