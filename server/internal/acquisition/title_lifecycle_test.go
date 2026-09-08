package acquisition

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/notification"
)

func titleLifecycleFixture(t *testing.T) *sql.DB {
	t.Helper()
	db, err := database.Open(context.Background(), filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	_, err = db.Exec(`
 INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('reader','reader','reader','Reader','x',0,0,'2026-01-01','2026-01-01');
 INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01','2026-01-01');
 INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('library','reader','owner','2026-01-01');
 INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('source','library','local','Downloads','/downloads',1,'2026-01-01','2026-01-01');
 INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,created_at,updated_at) VALUES('legacy','library','reader','source','Alice','requested','2026-01-01','2026-01-01');
 INSERT INTO acquisition_results(id,request_id,title,download_url,source,size,created_at) VALUES('release','legacy','Alice EPUB','magnet:?xt=urn:btih:0123456789012345678901234567890123456789','test',123,'2026-01-01');
 INSERT INTO title_requests(id,library_id,requested_by,title,created_at,updated_at) VALUES('title','library','reader','Alice','2026-01-01','2026-01-01');
 INSERT INTO title_request_formats(title_request_id,format,state,source_id,legacy_acquisition_request_id,created_at,updated_at) VALUES('title','ebook','searching','source','legacy','2026-01-01','2026-01-01');`)
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func TestCancelBeforeGuidedSubmission(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	legacy := NewStore(db, nil)
	titles := NewTitleRequestStore(db)
	titles.SetAcquisitionStore(legacy)
	if err := titles.Cancel(ctx, auth.User{ID: "reader"}, "library", "title", "ebook"); err != nil {
		t.Fatal(err)
	}
	var state string
	if err := db.QueryRow(`SELECT fulfillment_state FROM acquisition_requests WHERE id='legacy'`).Scan(&state); err != nil || state != "failed" {
		t.Fatalf("canceled download state=%q err=%v", state, err)
	}
	_, err := legacy.selectGuidedRelease(ctx, claimedTitleFormat{requestID: "title", libraryID: "library", requestedBy: "reader", format: "ebook", sourceID: "source"}, "legacy", "release")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("canceled submission: %v", err)
	}
	if err := legacy.Retry(ctx, auth.User{ID: "reader"}, "library", "legacy"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("retry canceled title: %v", err)
	}
}

func TestCancelDuringGuidedSubmission(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	entered, release := make(chan struct{}), make(chan struct{})
	var present atomic.Bool
	var adds, deletes atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "test"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/add":
			close(entered)
			<-release
			adds.Add(1)
			present.Store(true)
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/info":
			if present.Load() {
				_, _ = w.Write([]byte(`[{"hash":"0123456789012345678901234567890123456789","tags":"legacy"}]`))
			} else {
				_, _ = w.Write([]byte(`[]`))
			}
		case "/api/v2/torrents/delete":
			deletes.Add(1)
			present.Store(false)
		case "/api/v2/torrents/categories":
			_, _ = w.Write([]byte(`{}`))
		default:
			_, _ = w.Write([]byte(`[]`))
		}
	}))
	defer provider.Close()
	client, _ := New(Options{QBitURL: provider.URL})
	legacy := NewStore(db, client)
	titles := NewTitleRequestStore(db)
	titles.SetAcquisitionStore(legacy)
	submitted := make(chan error, 1)
	go func() {
		_, err := legacy.selectGuidedRelease(ctx, claimedTitleFormat{requestID: "title", libraryID: "library", requestedBy: "reader", format: "ebook", sourceID: "source"}, "legacy", "release")
		submitted <- err
	}()
	<-entered
	canceled := make(chan error, 1)
	go func() { canceled <- titles.Cancel(ctx, auth.User{ID: "reader"}, "library", "title", "ebook") }()
	close(release)
	if err := <-submitted; err != nil {
		t.Fatal(err)
	}
	if err := <-canceled; err != nil {
		t.Fatal(err)
	}
	if present.Load() || adds.Load() != 1 || deletes.Load() != 1 {
		t.Fatalf("present=%v adds=%d deletes=%d", present.Load(), adds.Load(), deletes.Load())
	}
	if err := legacy.recoverSubmissions(ctx); err != nil {
		t.Fatal(err)
	}
	if adds.Load() != 1 {
		t.Fatal("recovery resubmitted canceled download")
	}
}

func TestRetriedTitleFollowsCurrentDownload(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	if _, err := db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at) VALUES('scan','source','failed','2026-01-01'); UPDATE acquisition_requests SET fulfillment_state='failed',scan_id='scan'; UPDATE title_request_formats SET state='failed'`); err != nil {
		t.Fatal(err)
	}
	legacy := NewStore(db, nil)
	legacy.SetScanRetry(func(context.Context, string, string) error { return nil })
	titles := NewTitleRequestStore(db)
	inbox := notification.New(db)
	titles.SetNotificationStore(inbox)
	if err := legacy.Retry(ctx, auth.User{ID: "reader"}, "library", "legacy"); err != nil {
		t.Fatal(err)
	}
	if err := titles.syncLegacyFulfillment(ctx); err != nil {
		t.Fatal(err)
	}
	var state string
	if err := db.QueryRow(`SELECT state FROM title_request_formats`).Scan(&state); err != nil || state != "scanning" {
		t.Fatalf("retried state=%q err=%v", state, err)
	}
	if _, err := db.Exec(`INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('work','library','Alice','2026-01-01','2026-01-01'); UPDATE acquisition_requests SET fulfillment_state='available',work_id='work'`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := titles.syncLegacyFulfillment(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.QueryRow(`SELECT state FROM title_request_formats`).Scan(&state); err != nil || state != "available" {
		t.Fatalf("ready state=%q err=%v", state, err)
	}
	notices, err := inbox.List(ctx, "reader", 20, 0)
	if err != nil || len(notices) != 1 || notices[0].Kind != "acquisition.available" || notices[0].ActionURL != "/consume/work?mode=read" {
		t.Fatalf("ready notices=%#v err=%v", notices, err)
	}
	var events int
	if err := db.QueryRow(`SELECT COUNT(*) FROM title_request_events WHERE state='available'`).Scan(&events); err != nil || events != 1 {
		t.Fatalf("ready events=%d err=%v", events, err)
	}
}

func TestReadyRequiresImportedRequestedMedia(t *testing.T) {
	for _, kind := range []string{"epub", "audio"} {
		t.Run(kind, func(t *testing.T) {
			ctx := context.Background()
			db := titleLifecycleFixture(t)
			_, err := db.Exec(`
 INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('work','library','Alice','2026-01-01','2026-01-01');
 INSERT INTO representations(id,work_id,kind,label,created_at,updated_at) VALUES('rep','work',?1,'Imported','2026-01-01','2026-01-01');
 INSERT INTO media(id,representation_id,kind,path,sha256,created_at) VALUES('media','rep',?1,'test',?2,'2026-01-01');
 INSERT INTO source_scans(id,source_id,state,created_at) VALUES('scan','source','completed','2026-01-01');
 INSERT INTO source_entries(id,source_id,relative_path,size_bytes,modified_at,state,created_at,updated_at,last_seen_scan_id) VALUES('entry','source','book',1,'2026-01-01','registered','2026-01-01','2026-01-01','scan');
 INSERT INTO media_locations(media_id,source_entry_id,created_at) VALUES('media','entry','2026-01-01');
 INSERT INTO import_groups(id,library_id,logical_key,content_key,state,confidence,proposed_title,proposed_author,normalized_title,normalized_author,reasons_json,revision,created_at,updated_at) VALUES('proposal','library','key','content','obsolete','high','Alice','','alice','','[]',1,'2026-01-01','2026-01-01');
 INSERT INTO import_items(group_id,source_entry_id,representation_kind,proposed_label,evidence_json) VALUES('proposal','entry','epub','Imported','{}');
 INSERT INTO acquisition_import_outcomes(acquisition_request_id,scan_id,state,proposal_id,accepted_work_id,updated_at) VALUES('legacy','scan','accepted','proposal','work','2026-01-01');
 UPDATE acquisition_requests SET fulfillment_state='scanning';`, kind, strings.Repeat("a", 64))
			if err != nil {
				t.Fatal(err)
			}
			downloads := NewStore(db, nil)
			if err := downloads.reconcileFulfillment(ctx); err != nil {
				t.Fatal(err)
			}
			want := "failed"
			if kind == "epub" {
				want = "available"
			}
			var state string
			if err := db.QueryRow(`SELECT fulfillment_state FROM acquisition_requests WHERE id='legacy'`).Scan(&state); err != nil || state != want {
				t.Fatalf("state=%q want=%q err=%v", state, want, err)
			}
		})
	}
}

func TestCancellationFailurePreservesRequest(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	if _, err := db.Exec(`
		UPDATE acquisition_requests
		SET fulfillment_state='downloading',
			torrent_hash='shared',
			torrent_ownership='created';

		UPDATE title_request_formats
		SET state='downloading';

		INSERT INTO acquisition_requests (
			id, library_id, requested_by, query, status, torrent_hash,
			fulfillment_state, created_at, updated_at
		)
		VALUES (
			'other', 'library', 'reader', 'Other', 'queued', 'shared',
			'downloading', '2026-01-01', '2026-01-01'
		)
	`); err != nil {
		t.Fatal(err)
	}

	var failDelete atomic.Bool
	failDelete.Store(true)
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "test"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/info":
			_, _ = w.Write([]byte(`[{"hash":"shared","tags":"legacy"}]`))
		case "/api/v2/torrents/delete":
			if failDelete.Load() {
				http.Error(w, "unavailable", http.StatusServiceUnavailable)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()

	client, _ := New(Options{QBitURL: provider.URL})
	legacy := NewStore(db, client)
	titles := NewTitleRequestStore(db)
	titles.SetAcquisitionStore(legacy)
	actor := auth.User{ID: "reader"}
	if err := titles.Cancel(ctx, actor, "library", "title", "ebook"); err == nil || calls.Load() != 0 {
		t.Fatalf("shared cancellation error=%v provider calls=%d", err, calls.Load())
	}

	if _, err := db.Exec(`DELETE FROM acquisition_requests WHERE id='other'`); err != nil {
		t.Fatal(err)
	}

	if err := titles.Cancel(ctx, actor, "library", "title", "ebook"); err == nil {
		t.Fatal("provider failure was ignored")
	}

	var state string
	if err := db.QueryRow(`SELECT state FROM title_request_formats`).Scan(&state); err != nil || state != "downloading" {
		t.Fatalf("failed cancellation state=%q err=%v", state, err)
	}

	failDelete.Store(false)
	if err := titles.Cancel(ctx, actor, "library", "title", "ebook"); err != nil {
		t.Fatal(err)
	}

	if err := titles.Cancel(ctx, actor, "library", "title", "ebook"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("repeat cancel: %v", err)
	}
}
