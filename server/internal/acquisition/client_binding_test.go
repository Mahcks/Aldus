package acquisition

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
)

func TestChangingDefaultDoesNotRedirectCancellation(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	if _, err := db.Exec(`
		UPDATE acquisition_requests
		SET fulfillment_state='downloading', selected_url='magnet:?xt=urn:btih:abcdef',
			torrent_hash='owned', torrent_ownership='created'
		WHERE id='legacy'
	`); err != nil {
		t.Fatal(err)
	}

	var originalDeletes, replacementDeletes atomic.Int32
	serve := func(deletes *atomic.Int32) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/api/v2/auth/login":
				http.SetCookie(w, &http.Cookie{Name: "SID", Value: "test"})
				fmt.Fprint(w, "Ok.")
			case "/api/v2/torrents/info":
				fmt.Fprint(w, `[{"hash":"owned"}]`)
			case "/api/v2/torrents/delete":
				deletes.Add(1)
			default:
				http.NotFound(w, r)
			}
		}))
	}
	original := serve(&originalDeletes)
	defer original.Close()

	replacement := serve(&replacementDeletes)
	defer replacement.Close()

	client, _ := New(Options{QBitURL: original.URL})
	store := NewStore(db, client)
	actor := auth.User{ID: "reader", Admin: true}
	if _, err := store.UpdateSettings(ctx, actor, SettingsUpdate{QBitURL: replacement.URL}); err != nil {
		t.Fatal(err)
	}

	// Restart with the new default: existing jobs must still use the old client.
	client, _ = New(Options{QBitURL: replacement.URL})
	store = NewStore(db, client)
	if err := store.Cancel(ctx, actor, "library", "legacy"); err != nil {
		t.Fatal(err)
	}

	if originalDeletes.Load() != 1 || replacementDeletes.Load() != 0 {
		t.Fatalf("original deletes=%d; replacement deletes=%d", originalDeletes.Load(), replacementDeletes.Load())
	}
}

func TestRetryAndRecoveryKeepOriginalClient(t *testing.T) {
	for _, operation := range []string{"retry", "recovery"} {
		t.Run(operation, func(t *testing.T) {
			ctx := context.Background()
			db := titleLifecycleFixture(t)
			state := "failed"
			if operation == "recovery" {
				state = "submitting"
			}

			if _, err := db.Exec(`
				UPDATE acquisition_requests
				SET fulfillment_state=?, selected_url='magnet:?xt=urn:btih:abcdef', torrent_hash='owned'
				WHERE id='legacy'
			`, state); err != nil {
				t.Fatal(err)
			}

			var originalReads, replacementCalls atomic.Int32
			original := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/v2/auth/login" {
					http.SetCookie(w, &http.Cookie{Name: "SID", Value: "test"})
					fmt.Fprint(w, "Ok.")
					return
				}

				if r.URL.Path == "/api/v2/torrents/info" {
					originalReads.Add(1)
					fmt.Fprint(w, `[{"hash":"owned"}]`)
					return
				}

				http.NotFound(w, r)
			}))
			defer original.Close()

			replacement := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				replacementCalls.Add(1)
				http.Error(w, "unexpected replacement client", http.StatusServiceUnavailable)
			}))
			defer replacement.Close()

			client, _ := New(Options{QBitURL: original.URL})
			store := NewStore(db, client)
			actor := auth.User{ID: "reader", Admin: true}
			if _, err := store.UpdateSettings(ctx, actor, SettingsUpdate{QBitURL: replacement.URL}); err != nil {
				t.Fatal(err)
			}

			var err error
			if operation == "retry" {
				err = store.Retry(ctx, actor, "library", "legacy")
			} else {
				err = store.recoverSubmissions(ctx)
			}

			if err != nil {
				t.Fatal(err)
			}

			if originalReads.Load() != 1 || replacementCalls.Load() != 0 {
				t.Fatalf("original reads=%d; replacement calls=%d", originalReads.Load(), replacementCalls.Load())
			}
		})
	}
}

func TestClientCredentialRotationPreservesJobMapping(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	client, _ := New(Options{
		QBitURL:      "http://original.invalid",
		QBitUsername: "reader",
		QBitPassword: "old-test-password",
		Category:     "old-category",
		DownloadRoot: "/old-downloads",
	})
	store := NewStore(db, client)
	if _, _, err := store.requestClient(ctx, "legacy"); err != nil {
		t.Fatal(err)
	}

	_, err := store.UpdateSettings(ctx, auth.User{Admin: true}, SettingsUpdate{
		QBitURL:          "http://original.invalid",
		QBitUsername:     "reader",
		QBitPassword:     "rotated-test-password",
		QBitCategory:     "new-category",
		QBitDownloadRoot: "/new-downloads",
	})
	if err != nil {
		t.Fatal(err)
	}

	bound, _, err := store.requestClient(ctx, "legacy")
	if err != nil {
		t.Fatal(err)
	}

	if bound.options.Category != "old-category" || bound.options.DownloadRoot != "/old-downloads" {
		t.Fatal("changing the default replaced the existing job's path/category mapping")
	}

	if bound.options.QBitPassword != "rotated-test-password" {
		t.Fatal("credential rotation did not reach existing jobs on the same endpoint")
	}
}

func TestUnavailableOriginalClientDoesNotBlockOtherDownloads(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	if _, err := db.Exec(`
		UPDATE acquisition_requests
		SET fulfillment_state='submitting', selected_url='magnet:?xt=urn:btih:abcdef', torrent_hash='old'
		WHERE id='legacy'
	`); err != nil {
		t.Fatal(err)
	}

	original := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "offline", http.StatusServiceUnavailable)
	}))
	defer original.Close()

	replacement := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v2/auth/login" {
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "test"})
			fmt.Fprint(w, "Ok.")
			return
		}

		fmt.Fprint(w, `[{"hash":"new","state":"downloading","progress":0.4}]`)
	}))
	defer replacement.Close()

	client, _ := New(Options{QBitURL: original.URL})
	store := NewStore(db, client)
	if _, err := store.UpdateSettings(ctx, auth.User{Admin: true}, SettingsUpdate{QBitURL: replacement.URL}); err != nil {
		t.Fatal(err)
	}

	if _, err := db.Exec(`
		INSERT INTO acquisition_requests (
			id, library_id, query, status, fulfillment_state, torrent_hash, created_at, updated_at
		)
		VALUES ('new', 'library', 'Alice', 'queued', 'downloading', 'new', '2026-01-01', '2026-01-01')
	`); err != nil {
		t.Fatal(err)
	}

	store.SetHandoff(func(context.Context, string, string, string, string) (string, error) {
		t.Fatal("incomplete download must not import")
		return "", nil
	})
	if err := store.Poll(ctx); err == nil {
		t.Fatal("original client outage was not reported")
	}

	var progress float64
	if err := db.QueryRow(`SELECT download_progress FROM acquisition_requests WHERE id='new'`).Scan(&progress); err != nil {
		t.Fatal(err)
	}

	if progress != 0.4 {
		t.Fatalf("other client's progress was not updated: %v", progress)
	}
}

func TestReplacingClientDoesNotCopyItsPassword(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	client, _ := New(Options{QBitURL: "http://original.invalid", QBitPassword: "original-test-password"})
	store := NewStore(db, client)
	settings, err := store.UpdateSettings(ctx, auth.User{Admin: true}, SettingsUpdate{QBitURL: "http://replacement.invalid"})
	if err != nil {
		t.Fatal(err)
	}

	if settings.HasQBitPassword {
		t.Fatal("original client's password was copied to a different endpoint")
	}
}
