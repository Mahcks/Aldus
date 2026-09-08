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

func TestCancelPreservesAdoptedTorrent(t *testing.T) {
	db := titleLifecycleFixture(t)
	var deletes atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			fmt.Fprint(w, "Ok.")
		case "/api/v2/torrents/info":
			fmt.Fprint(w, `[{"hash":"0123456789012345678901234567890123456789"}]`)
		case "/api/v2/torrents/add":
			w.WriteHeader(http.StatusConflict)
		case "/api/v2/torrents/delete":
			deletes.Add(1)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, _ := New(Options{QBitURL: server.URL})
	store := NewStore(db, client)
	actor := auth.User{ID: "reader", Admin: true}
	if _, err := store.Select(context.Background(), actor, "library", "legacy", "release"); err != nil {
		t.Fatal(err)
	}

	if err := store.Cancel(context.Background(), actor, "library", "legacy"); err != nil {
		t.Fatal(err)
	}

	if deletes.Load() != 0 {
		t.Fatal("cancel deleted a torrent that already existed")
	}
}

func TestOwnedCancellationUsesPersistedHash(t *testing.T) {
	for _, ownership := range []string{"created", "adopted", "unknown"} {
		t.Run(ownership, func(t *testing.T) {
			db := titleLifecycleFixture(t)
			if _, err := db.Exec(`
				UPDATE acquisition_requests
				SET fulfillment_state='downloading',
					download_job_id='owned',
					torrent_ownership=?
			`, ownership); err != nil {
				t.Fatal(err)
			}

			var deletes atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/v2/auth/login":
					http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
					fmt.Fprint(w, "Ok.")
				case "/api/v2/torrents/info":
					fmt.Fprint(w, `[{"hash":"unrelated","tags":"legacy"},{"hash":"OWNED","tags":""}]`)
				case "/api/v2/torrents/delete":
					if r.FormValue("hashes") != "OWNED" || r.FormValue("deleteFiles") != "true" {
						t.Errorf("wrong deletion: %v", r.Form)
					}
					deletes.Add(1)
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			client, _ := New(Options{QBitURL: server.URL})
			// Reconstructing the store models a restart; ownership must come from SQLite.
			store := NewStore(db, client)
			if ownership == "unknown" {
				if _, err := db.Exec(`
					UPDATE acquisition_requests
					SET fulfillment_state='submitting',
						selected_url='https://download.test/book'
					WHERE id='legacy'
				`); err != nil {
					t.Fatal(err)
				}

				if err := store.recoverSubmissions(context.Background()); err != nil {
					t.Fatal(err)
				}
			}

			if err := store.Cancel(context.Background(), auth.User{ID: "reader", Admin: true}, "library", "legacy"); err != nil {
				t.Fatal(err)
			}

			want := int32(0)
			if ownership == "created" {
				want = 1
			}

			if deletes.Load() != want {
				t.Fatalf("deletes=%d want=%d", deletes.Load(), want)
			}
		})
	}
}

func TestSubmissionOwnershipRequiresNewTaggedTorrent(t *testing.T) {
	const hash = "0123456789012345678901234567890123456789"
	for _, scenario := range []string{"created", "adopted", "unknown", "race", "lookup_failed"} {
		t.Run(scenario, func(t *testing.T) {
			var added atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/v2/auth/login":
					http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
					fmt.Fprint(w, "Ok.")
				case "/api/v2/torrents/info":
					if scenario == "lookup_failed" && !added.Load() {
						http.Error(w, "offline", 503)
						return
					}
					if scenario == "adopted" || added.Load() {
						tag := ""
						if added.Load() && scenario != "unknown" && scenario != "race" {
							tag = "request"
						}

						fmt.Fprintf(w, `[{"hash":"%s","tags":"%s"}]`, hash, tag)
					} else {
						fmt.Fprint(w, "[]")
					}
				case "/api/v2/torrents/add":
					added.Store(true)
					fmt.Fprint(w, "Ok.")
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			client, _ := New(Options{QBitURL: server.URL})
			receipt, err := client.submitTracked(context.Background(), "magnet:?xt=urn:btih:"+hash, "request")
			want := scenario
			if scenario == "race" || scenario == "lookup_failed" {
				want = "unknown"
			}

			if err != nil || receipt.JobID != hash || receipt.Ownership != want {
				t.Fatalf("receipt=%+v err=%v", receipt, err)
			}

			if scenario == "adopted" && added.Load() {
				t.Fatal("resubmitted existing seed")
			}
		})
	}
}
