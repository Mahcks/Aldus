package acquisition

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

func TestProwlarrEmptySuccessSurvivesPartialFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/indexer":
			fmt.Fprint(w, `[{"id":1,"name":"Books","protocol":"torrent","enable":true},{"id":2,"name":"Audio","protocol":"torrent","enable":true}]`)
		case "/1/api":
			fmt.Fprint(w, "<rss><channel/></rss>")
		default:
			http.Error(w, "secret-key", http.StatusServiceUnavailable)
		}
	}))
	defer server.Close()

	client, _ := New(Options{IndexerKind: "prowlarr", IndexerURL: server.URL})
	if _, err := client.Search(context.Background(), "Alice"); err != nil {
		t.Fatalf("successful empty indexer was treated as total outage: %v", err)
	}
}

func TestProwlarrSearchReportOutcomes(t *testing.T) {
	for _, scenario := range []string{"success", "partial", "empty", "failed", "disabled", "canceled"} {
		t.Run(scenario, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/v1/indexer" {
					fmt.Fprintf(
						w,
						`[{"id":1,"name":"Books secret-key","protocol":"torrent","enable":%t},{"id":2,"name":"Audio","protocol":"torrent","enable":%t}]`,
						scenario != "disabled",
						scenario != "disabled",
					)
					return
				}

				if scenario == "failed" || scenario == "partial" && r.URL.Path == "/2/api" {
					http.Error(w, "secret-key https://private.invalid", 503)
					return
				}

				if scenario == "empty" {
					fmt.Fprint(w, "<rss><channel/></rss>")
					return
				}

				fmt.Fprint(w, `<rss><channel><item><title>Alice EPUB</title><link>magnet:?xt=urn:btih:abcdef</link></item><item><title>Unknown ZIP</title></item></channel></rss>`)
			}))
			defer server.Close()

			client, _ := New(Options{IndexerKind: "prowlarr", IndexerURL: server.URL, IndexerAPIKey: "secret-key"})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			if scenario == "canceled" {
				cancel()
			}

			report, err := client.SearchReport(ctx, "Alice")
			wantError := scenario == "failed" || scenario == "disabled" || scenario == "canceled"
			if (err != nil) != wantError {
				t.Fatalf("report=%+v err=%v", report, err)
			}

			if scenario == "canceled" {
				return
			}

			failures, excluded := 0, 0
			for _, item := range report.Indexers {
				if strings.Contains(item.Name+item.Error, "secret-key") || strings.Contains(item.Error, "://") {
					t.Fatalf("unsafe diagnostic: %+v", item)
				}

				if item.Error != "" {
					failures++
				}

				excluded += item.Excluded
			}

			if scenario == "partial" && (failures != 1 || excluded != 1 || len(report.Results) != 1) {
				t.Fatalf("partial report=%+v", report)
			}

			if scenario == "disabled" && (!report.Reachable || len(report.Indexers) != 0) {
				t.Fatalf("disabled report=%+v", report)
			}
		})
	}
}

func TestAcquisitionSettingsDoesNotClaimUntestedFileAccess(t *testing.T) {
	db := titleLifecycleFixture(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/indexer":
			fmt.Fprint(w, "[]")
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			fmt.Fprint(w, "Ok.")
		case "/api/v2/torrents/info":
			fmt.Fprint(w, "[]")
		default:
			t.Errorf("connection test mutated client: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client, _ := New(Options{
		IndexerKind:  "prowlarr",
		IndexerURL:   server.URL,
		QBitURL:      server.URL,
		DownloadRoot: "/downloads",
	})
	store := NewStore(db, client)
	status, err := store.TestConnections(context.Background(), auth.User{Admin: true})
	if err != nil || !status.ProwlarrOK || status.IndexerCount != 0 || !status.QBitTorrentOK || status.FileVisibility != "not_tested" {
		t.Fatalf("status=%+v err=%v", status, err)
	}
}

func TestSearchReportUsesOneSearchAndProtectsDetails(t *testing.T) {
	db := titleLifecycleFixture(t)
	var searches atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/indexer" {
			fmt.Fprint(w, `[{"id":1,"name":"Private indexer","protocol":"torrent","enable":true}]`)
			return
		}

		searches.Add(1)
		fmt.Fprint(w, `<rss><channel><item><title>Alice EPUB</title><link>magnet:?xt=urn:btih:abcdef</link></item></channel></rss>`)
	}))
	defer server.Close()

	client, _ := New(Options{IndexerKind: "prowlarr", IndexerURL: server.URL})
	store := NewStore(db, client)
	store.metadataCache["alice"] = cachedMetadata{expires: time.Now().Add(time.Hour)}
	for _, admin := range []bool{true, false} {
		if _, err := db.Exec("UPDATE users SET is_admin=? WHERE id='reader'", admin); err != nil {
			t.Fatal(err)
		}

		value, err := store.Discover(context.Background(), auth.User{ID: "reader", Admin: admin}, "library", "source", "Alice")
		if err != nil || len(value.Results) != 1 || (value.Report != nil) != admin {
			t.Fatalf("admin=%v discovery=%+v err=%v", admin, value, err)
		}
	}

	if searches.Load() != 2 {
		t.Fatalf("duplicate diagnostic searches: %d", searches.Load())
	}

	if _, _, err := store.SearchWithReport(context.Background(), auth.User{ID: "reader"}, "library", "legacy"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-admin diagnostics=%v", err)
	}

	if _, _, err := store.SearchWithReport(context.Background(), auth.User{ID: "reader", Admin: true}, "other-library", "legacy"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-library diagnostics=%v", err)
	}
}
