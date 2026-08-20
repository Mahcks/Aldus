package acquisition

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/notification"
)

func TestTitleRequestsEnforceApprovalPolicyAndRecordTransitions(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	applyTestMigration(t, db, "acquisition_policies", "../database/migrations/027_acquisition_policy.sql")
	applyTestMigration(t, db, "title_requests", "../database/migrations/028_title_requests.sql")
	root := t.TempDir()
	if _, err := db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES
			('reader','reader','reader','Reader','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
			('owner','owner','owner','Owner','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
			('other','other','other','Other','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO library_members(library_id,user_id,role,can_request_acquisitions,can_bypass_acquisition_approval,created_at) VALUES
			('library','reader','reader',1,0,'2026-01-01T00:00:00Z'),
			('library','owner','owner',1,1,'2026-01-01T00:00:00Z');
		INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES
			('ebooks','library','local','Ebooks',?,1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
			('audio','library','local','Audio',?,1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO acquisition_policies(library_id,default_ebook_source_id,default_audiobook_source_id,max_active_requests,updated_at)
		VALUES('library','ebooks','audio',1,'2026-01-01T00:00:00Z')`, filepath.Join(root, "ebooks"), filepath.Join(root, "audio")); err != nil {
		t.Fatal(err)
	}

	store := NewTitleRequestStore(db)
	inbox := notification.New(db)
	store.SetNotificationStore(inbox)
	reader := auth.User{ID: "reader"}
	request, err := store.Create(ctx, reader, CreateTitleRequest{LibraryID: "library", ExternalSource: "open_library", ExternalID: "OL1W", Title: "Alice", Author: "Lewis Carroll", Formats: []string{"ebook", "audiobook"}})
	if err != nil || len(request.Formats) != 2 || request.Formats[0].State != "pending_approval" || request.Formats[1].State != "pending_approval" {
		t.Fatalf("created request=%#v err=%v", request, err)
	}
	var ebookSource, audioSource string
	if err := db.QueryRow(`SELECT (SELECT source_id FROM title_request_formats WHERE title_request_id=? AND format='ebook'),(SELECT source_id FROM title_request_formats WHERE title_request_id=? AND format='audiobook')`, request.ID, request.ID).Scan(&ebookSource, &audioSource); err != nil || ebookSource != "ebooks" || audioSource != "audio" {
		t.Fatalf("resolved sources=%q %q, %v", ebookSource, audioSource, err)
	}
	if _, err := store.Create(ctx, reader, CreateTitleRequest{LibraryID: "library", Title: "Second", Formats: []string{"ebook"}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("active request limit error=%v", err)
	}
	if err := store.Approve(ctx, reader, "library", request.ID, "ebook"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("reader approval error=%v", err)
	}
	owner := auth.User{ID: "owner"}
	if err := store.Approve(ctx, owner, "library", request.ID, "ebook"); err != nil {
		t.Fatal(err)
	}
	if err := store.Deny(ctx, owner, "library", request.ID, "audiobook"); err != nil {
		t.Fatal(err)
	}
	if err := store.Cancel(ctx, reader, "library", request.ID, "ebook"); err != nil {
		t.Fatal(err)
	}
	request, err = store.Get(ctx, reader, "library", request.ID)
	if err != nil || request.Formats[0].State != "denied" || request.Formats[1].State != "canceled" {
		t.Fatalf("transitioned request=%#v err=%v", request, err)
	}
	if _, err := store.Get(ctx, auth.User{ID: "other"}, "library", request.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unrelated user get error=%v", err)
	}
	listed, err := store.List(ctx, owner, "library")
	if err != nil || len(listed) != 1 {
		t.Fatalf("owner list=%#v err=%v", listed, err)
	}
	var events int
	if err := db.QueryRow(`SELECT COUNT(*) FROM title_request_events WHERE title_request_id=?`, request.ID).Scan(&events); err != nil || events != 5 {
		t.Fatalf("events=%d, %v", events, err)
	}
	history, err := store.Events(ctx, reader, "library", request.ID)
	if err != nil || len(history) != 5 || history[0].State != "canceled" || history[0].EventType != "canceled" {
		t.Fatalf("reader history=%#v, %v", history, err)
	}
	if _, err := store.Events(ctx, auth.User{ID: "other"}, "library", request.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unrelated user history error=%v", err)
	}
	readerNotifications, err := inbox.List(ctx, "reader", 20, 0)
	if err != nil || len(readerNotifications) != 5 {
		t.Fatalf("reader notifications=%#v err=%v", readerNotifications, err)
	}
	ownerNotifications, err := inbox.List(ctx, "owner", 20, 0)
	if err != nil || len(ownerNotifications) != 2 || ownerNotifications[0].Kind != "acquisition.approval_needed" {
		t.Fatalf("owner notifications=%#v err=%v", ownerNotifications, err)
	}

	if _, err := db.Exec(`UPDATE library_members SET can_bypass_acquisition_approval=1 WHERE library_id='library' AND user_id='reader'`); err != nil {
		t.Fatal(err)
	}
	automatic, err := store.Create(ctx, reader, CreateTitleRequest{LibraryID: "library", Title: "Earthsea", Formats: []string{"ebook"}})
	if err != nil || len(automatic.Formats) != 1 || automatic.Formats[0].State != "wanted" {
		t.Fatalf("bypass request=%#v err=%v", automatic, err)
	}
}

func TestGuidedTitleRequestWorkerFiltersRetriesAndSubmitsOnce(t *testing.T) {
	ctx := context.Background()
	var adds atomic.Int32
	var addedTag string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/indexer":
			if strings.Contains(r.URL.Query().Get("q"), "No Audio") {
				_, _ = w.Write([]byte(`<rss><channel><item><title>No Audio English EPUB</title><enclosure url="https://download.test/wrong-kind" length="500"/></item></channel></rss>`))
				return
			}
			_, _ = w.Write([]byte(`<rss><channel>
				<item><title>Alice English EPUB Oversize</title><enclosure url="https://download.test/large" length="2048"/></item>
				<item><title>Alice Abridged English EPUB</title><enclosure url="https://download.test/abridged" length="500"/></item>
				<item><title>Alice English EPUB</title><enclosure url="https://download.test/alice" length="500"/></item>
			</channel></rss>`))
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/add":
			if err := r.ParseMultipartForm(1024); err != nil {
				t.Fatal(err)
			}
			adds.Add(1)
			addedTag = r.FormValue("tags")
			if r.FormValue("urls") != "https://download.test/alice" {
				t.Fatalf("selected release=%q", r.FormValue("urls"))
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"added_torrent_ids":[],"failure_count":0,"pending_count":1,"success_count":0}`))
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
	applyTestMigration(t, db, "acquisition_policies", "../database/migrations/027_acquisition_policy.sql")
	applyTestMigration(t, db, "title_requests", "../database/migrations/028_title_requests.sql")
	if _, err := db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at)
		VALUES('owner','owner','owner','Owner','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO library_members(library_id,user_id,role,can_request_acquisitions,can_bypass_acquisition_approval,created_at)
		VALUES('library','owner','owner',1,1,'2026-01-01T00:00:00Z');
		INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at)
		VALUES('source','library','local','Downloads','/downloads',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO acquisition_policies(library_id,default_ebook_source_id,default_audiobook_source_id,max_ebook_bytes,max_audiobook_bytes,allowed_ebook_extensions,allowed_audiobook_extensions,preferred_language,allow_abridged,max_active_requests,updated_at)
		VALUES('library','source','source',1024,1024,'epub','m4b,mp3','en',0,10,'2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	client, err := New(Options{IndexerURL: server.URL + "/indexer", QBitURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	legacy := NewStore(db, client)
	store := NewTitleRequestStore(db)
	store.SetAcquisitionStore(legacy)
	inbox := notification.New(db)
	store.SetNotificationStore(inbox)
	owner := auth.User{ID: "owner"}
	alice, err := store.Create(ctx, owner, CreateTitleRequest{LibraryID: "library", Title: "Alice", Formats: []string{"ebook"}})
	if err != nil {
		t.Fatal(err)
	}
	missing, err := store.Create(ctx, owner, CreateTitleRequest{LibraryID: "library", Title: "No Audio", Formats: []string{"audiobook"}})
	if err != nil {
		t.Fatal(err)
	}
	canceled, err := store.Create(ctx, owner, CreateTitleRequest{LibraryID: "library", Title: "Canceled", Formats: []string{"ebook"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Cancel(ctx, owner, "library", canceled.ID, "ebook"); err != nil {
		t.Fatal(err)
	}
	if err := store.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	if adds.Load() != 1 || addedTag == "" {
		t.Fatalf("downloads=%d tag=%q", adds.Load(), addedTag)
	}
	var state, legacyID, legacyState string
	if err := db.QueryRow(`SELECT f.state,COALESCE(f.legacy_acquisition_request_id,''),COALESCE(a.fulfillment_state,'') FROM title_request_formats f LEFT JOIN acquisition_requests a ON a.id=f.legacy_acquisition_request_id WHERE f.title_request_id=? AND f.format='ebook'`, alice.ID).Scan(&state, &legacyID, &legacyState); err != nil || state != "submitting" || legacyState != "submitting" || legacyID != addedTag {
		t.Fatalf("alice state=%q legacy=%q legacy state=%q tag=%q err=%v", state, legacyID, legacyState, addedTag, err)
	}
	var retries int
	var next string
	if err := db.QueryRow(`SELECT state,retry_count,COALESCE(next_search_at,'') FROM title_request_formats WHERE title_request_id=? AND format='audiobook'`, missing.ID).Scan(&state, &retries, &next); err != nil || state != "awaiting_release" || retries != 1 || next == "" {
		t.Fatalf("missing state=%q retries=%d next=%q err=%v", state, retries, next, err)
	}
	if err := store.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	if adds.Load() != 1 {
		t.Fatalf("duplicate downloads=%d", adds.Load())
	}
	if err := db.QueryRow(`SELECT state FROM title_request_formats WHERE title_request_id=?`, canceled.ID).Scan(&state); err != nil || state != "canceled" {
		t.Fatalf("canceled state=%q err=%v", state, err)
	}
	if _, err := db.Exec(`INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('alice-work','library','Alice','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); UPDATE acquisition_requests SET fulfillment_state='available',work_id='alice-work' WHERE id=?`, legacyID); err != nil {
		t.Fatal(err)
	}
	if err := store.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT state FROM title_request_formats WHERE title_request_id=?`, alice.ID).Scan(&state); err != nil || state != "available" {
		t.Fatalf("available state=%q err=%v", state, err)
	}
	notifications, err := inbox.List(ctx, "owner", 20, 0)
	if err != nil || len(notifications) != 3 || notifications[0].Kind != "acquisition.available" {
		t.Fatalf("worker notifications=%#v err=%v", notifications, err)
	}
}

func TestGuidedResultsRejectWrongVolume(t *testing.T) {
	policy := guidedPolicy{maxBytes: 1024, allowedExtensions: map[string]bool{"epub": true}}
	results := matchingGuidedResults([]SearchResult{
		{Title: "Heartstopper - Volume 1 - Alice Oseman.epub", Size: 500, Kind: "ebook", Format: "epub"},
		{Title: "Heartstopper - Volume 2 - Alice Oseman.epub", Size: 500, Kind: "ebook", Format: "epub"},
	}, "Heartstopper, Volume 2", "ebook", policy)
	if len(results) != 1 || !strings.Contains(results[0].Title, "Volume 2") {
		t.Fatalf("matched %#v", results)
	}
}

func TestCancelTitleRequestStopsLinkedDownload(t *testing.T) {
	ctx := context.Background()
	var deletes atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/info":
			_, _ = w.Write([]byte(`[{"hash":"abc","tags":"legacy","state":"downloading","progress":0.5}]`))
		case "/api/v2/torrents/delete":
			deletes.Add(1)
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
	if _, err := db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('reader','reader','reader','Reader','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO library_members(library_id,user_id,role,can_request_acquisitions,created_at) VALUES('library','reader','reader',1,'2026-01-01T00:00:00Z');
		INSERT INTO acquisition_requests(id,library_id,requested_by,query,status,selected_url,download_state,download_error,fulfillment_state,created_at,updated_at) VALUES('legacy','library','reader','Alice','queued','https://download.test/alice','downloading','','downloading','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO title_requests(id,library_id,requested_by,title,created_at,updated_at) VALUES('title','library','reader','Alice','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO title_request_formats(title_request_id,format,state,legacy_acquisition_request_id,created_at,updated_at) VALUES('title','ebook','downloading','legacy','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	client, _ := New(Options{QBitURL: server.URL})
	legacy := NewStore(db, client)
	store := NewTitleRequestStore(db)
	store.SetAcquisitionStore(legacy)
	if err := store.Cancel(ctx, auth.User{ID: "reader"}, "library", "title", "ebook"); err != nil {
		t.Fatal(err)
	}
	var titleState, legacyState string
	if err := db.QueryRow(`SELECT f.state,a.fulfillment_state FROM title_request_formats f JOIN acquisition_requests a ON a.id=f.legacy_acquisition_request_id WHERE f.title_request_id='title'`).Scan(&titleState, &legacyState); err != nil || titleState != "canceled" || legacyState != "failed" || deletes.Load() != 1 {
		t.Fatalf("title=%q legacy=%q deletes=%d err=%v", titleState, legacyState, deletes.Load(), err)
	}
}

func applyTestMigration(t *testing.T, db *sql.DB, table, path string) {
	t.Helper()
	var exists bool
	if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)`, table).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists {
		return
	}
	schema, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(schema)); err != nil {
		t.Fatal(err)
	}
}
