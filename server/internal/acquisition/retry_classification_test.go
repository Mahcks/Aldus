package acquisition

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"testing"
)

func TestHistoricalReleaseFailureDoesNotRetryImportFailure(t *testing.T) {
	for _, previousURL := range []string{"https://download.test/old", "https://download.test/current"} {
		t.Run(previousURL, func(t *testing.T) {
			db := titleLifecycleFixture(t)
			_, err := db.Exec(`
				UPDATE title_request_formats SET state='scanning' WHERE title_request_id='title';
				UPDATE acquisition_requests
				SET fulfillment_state='failed', selected_url='https://download.test/current',
				    download_error='The import directory is not writable.'
				WHERE id='legacy';
				INSERT INTO acquisition_release_failures
				    (title_request_id,format,download_url,reason,failed_at)
				VALUES ('title','ebook',?,'Old metadata failure','2026-01-01')
			`, previousURL)
			if err != nil {
				t.Fatal(err)
			}

			store := NewTitleRequestStore(db)
			if err := store.syncLegacyFulfillment(context.Background()); err != nil {
				t.Fatal(err)
			}

			var state, diagnosis, nextSearch string
			err = db.QueryRow(`
				SELECT state,error,COALESCE(next_search_at,'')
				FROM title_request_formats WHERE title_request_id='title'
			`).Scan(&state, &diagnosis, &nextSearch)
			if err != nil {
				t.Fatal(err)
			}
			if state != "failed" || diagnosis != "The import directory is not writable." || nextSearch != "" {
				t.Fatalf("state=%q diagnosis=%q next=%q", state, diagnosis, nextSearch)
			}
		})
	}
}

func TestReleaseFailureClassificationResetsOnRetry(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	_, err := db.Exec(`
		UPDATE title_request_formats SET state='downloading' WHERE title_request_id='title';
		UPDATE acquisition_requests
		SET status='queued', fulfillment_state='downloading', torrent_hash='dead',
		    selected_url='https://download.test/current'
		WHERE id='legacy'
	`)
	if err != nil {
		t.Fatal(err)
	}

	qbit := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "test"})
			io.WriteString(w, "Ok.")
		case "/api/v2/torrents/info":
			io.WriteString(w, `[{"hash":"dead","state":"downloading"}]`)
		default:
			t.Errorf("unexpected operation: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer qbit.Close()

	client, err := New(Options{QBitURL: qbit.URL})
	if err != nil {
		t.Fatal(err)
	}
	acquisitions := NewStore(db, client)
	titles := NewTitleRequestStore(db)

	// Exercise a real metadata-stall failure, not just a manually seeded flag.
	now := time.Now().UTC()
	failed, err := acquisitions.monitorDownload(ctx, downloadMonitorRequest{
		id: "legacy", progressUpdated: now.Add(-31 * time.Minute).Format(time.RFC3339Nano),
	}, &Download{Hash: "dead", State: "metaDL"}, now)
	if err != nil || !failed {
		t.Fatalf("failed=%v err=%v", failed, err)
	}
	if err := titles.syncLegacyFulfillment(ctx); err != nil {
		t.Fatal(err)
	}

	var state, next string
	if err := db.QueryRow(`SELECT state,COALESCE(next_search_at,'') FROM title_request_formats WHERE title_request_id='title'`).Scan(&state, &next); err != nil {
		t.Fatal(err)
	}
	if state != "awaiting_release" || next == "" {
		t.Fatalf("fresh release failure: state=%q next=%q", state, next)
	}

	// Reuse the same request and URL through the actual retry path.
	if err := acquisitions.Retry(ctx, auth.User{ID: "reader"}, "library", "legacy"); err != nil {
		t.Fatal(err)
	}
	var failureKind string
	if err := db.QueryRow(`SELECT failure_kind FROM acquisition_requests WHERE id='legacy'`).Scan(&failureKind); err != nil {
		t.Fatal(err)
	}
	if failureKind != "" {
		t.Fatalf("retry retained failure kind %q", failureKind)
	}

	if _, err := db.Exec(`UPDATE title_request_formats SET state='scanning' WHERE title_request_id='title'`); err != nil {
		t.Fatal(err)
	}
	acquisitions.markDownloadProblem(ctx, "legacy", "Import storage unavailable.")
	if err := titles.syncLegacyFulfillment(ctx); err != nil {
		t.Fatal(err)
	}
	var diagnosis string
	if err := db.QueryRow(`SELECT state,error,COALESCE(next_search_at,'') FROM title_request_formats WHERE title_request_id='title'`).Scan(&state, &diagnosis, &next); err != nil {
		t.Fatal(err)
	}
	if state != "failed" || diagnosis != "Import storage unavailable." || next != "" {
		t.Fatalf("new import failure: state=%q error=%q next=%q", state, diagnosis, next)
	}
}

func TestReleaseFailureDoesNotResurrectCanceledOrDeniedRequest(t *testing.T) {
	for _, state := range []string{"canceled", "denied"} {
		t.Run(state, func(t *testing.T) {
			db := titleLifecycleFixture(t)
			if _, err := db.Exec(`UPDATE title_request_formats SET state=? WHERE title_request_id='title';
				UPDATE acquisition_requests SET fulfillment_state='failed',failure_kind='release' WHERE id='legacy'`, state); err != nil {
				t.Fatal(err)
			}
			if err := NewTitleRequestStore(db).syncLegacyFulfillment(context.Background()); err != nil {
				t.Fatal(err)
			}
			var actual string
			if err := db.QueryRow(`SELECT state FROM title_request_formats WHERE title_request_id='title'`).Scan(&actual); err != nil || actual != state {
				t.Fatalf("state=%q err=%v", actual, err)
			}
		})
	}
}

func TestReleaseFailureAndBlacklistAreAtomic(t *testing.T) {
	db := titleLifecycleFixture(t)
	_, err := db.Exec(`
		UPDATE acquisition_requests SET fulfillment_state='downloading',selected_url='https://download.test/current' WHERE id='legacy';
		CREATE TRIGGER reject_failure BEFORE INSERT ON acquisition_release_failures
		BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END
	`)
	if err != nil {
		t.Fatal(err)
	}
	if err := NewStore(db, nil).markReleaseProblem(context.Background(), "legacy", "dead", "Metadata stalled."); err == nil {
		t.Fatal("expected blacklist write failure")
	}

	var state, kind string
	if err := db.QueryRow(`SELECT fulfillment_state,failure_kind FROM acquisition_requests WHERE id='legacy'`).Scan(&state, &kind); err != nil {
		t.Fatal(err)
	}
	if state != "downloading" || kind != "" {
		t.Fatalf("partially committed failure: state=%q kind=%q", state, kind)
	}
}
