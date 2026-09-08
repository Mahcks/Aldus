package acquisition

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTorrentDownloadErrorRedactsCredentials(t *testing.T) {
	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close()

	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://elsewhere.invalid/download?apikey=sentinel-secret", http.StatusFound)
	}))
	defer redirect.Close()

	for _, tc := range []struct {
		name string
		url  string
	}{
		{"transport", closed.URL + "/download?apikey=sentinel-secret"},
		{"redirect", redirect.URL + "/download?passkey=sentinel-secret"},
		{"malformed", "http://example.invalid/%sentinel-secret"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client, err := New(Options{IndexerURL: closed.URL})
			if err != nil {
				t.Fatal(err)
			}

			_, err = client.fetchTorrent(context.Background(), tc.url)
			assertSafeTorrentError(t, err)
		})
	}

	for _, deadline := range []bool{false, true} {
		t.Run(fmt.Sprintf("deadline=%v", deadline), func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			want := context.Canceled
			if deadline {
				cancel()
				ctx, cancel = context.WithDeadline(context.Background(), time.Unix(0, 0))
				want = context.DeadlineExceeded
			}
			cancel()

			client, err := New(Options{IndexerURL: closed.URL})
			if err != nil {
				t.Fatal(err)
			}

			_, err = client.fetchTorrent(ctx, closed.URL+"/download?apikey=sentinel-secret")
			assertSafeTorrentError(t, err)
			if !errors.Is(err, want) {
				t.Fatalf("error does not preserve %v: %v", want, err)
			}
		})
	}
}

func assertSafeTorrentError(t *testing.T, err error) {
	t.Helper()

	if err == nil {
		t.Fatal("expected torrent download failure")
	}
	for _, forbidden := range []string{"sentinel-secret", "apikey", "passkey", "http://", "https://"} {
		if strings.Contains(err.Error(), forbidden) {
			t.Fatalf("download error contains %q", forbidden)
		}
	}
}

func TestSubmissionPersistsRedactedError(t *testing.T) {
	indexer := httptest.NewServer(http.NotFoundHandler())
	indexer.Close()

	qbit := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "test-session"})
			io.WriteString(w, "Ok.")
		case "/api/v2/torrents/info":
			io.WriteString(w, "[]")
		default:
			t.Errorf("unexpected qBittorrent operation: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer qbit.Close()

	db := titleLifecycleFixture(t)
	downloadURL := indexer.URL + "/download?apikey=sentinel-secret"
	if _, err := db.Exec(`UPDATE acquisition_results SET download_url=? WHERE id='release'`, downloadURL); err != nil {
		t.Fatal(err)
	}

	client, err := New(Options{IndexerURL: indexer.URL, QBitURL: qbit.URL})
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(db, client)
	claim := claimedTitleFormat{
		requestID:   "title",
		libraryID:   "library",
		requestedBy: "reader",
		format:      "ebook",
		sourceID:    "source",
	}

	_, err = store.selectGuidedRelease(context.Background(), claim, "legacy", "release")
	assertSafeTorrentError(t, err)

	var savedError, failureReason string
	err = db.QueryRow(`
		SELECT a.download_error, f.reason
		FROM acquisition_requests a
		JOIN acquisition_release_failures f ON f.download_url=a.selected_url
		WHERE a.id='legacy'
	`).Scan(&savedError, &failureReason)
	if err != nil {
		t.Fatal(err)
	}

	assertSafeTorrentError(t, errors.New(savedError))
	assertSafeTorrentError(t, errors.New(failureReason))
	if savedError == "" || savedError != failureReason {
		t.Fatal("request and release failure should contain the same safe diagnosis")
	}
}

func TestTorrentResponseErrorsAreSafe(t *testing.T) {
	for _, cancelDuringRead := range []bool{false, true} {
		t.Run(fmt.Sprintf("canceled=%v", cancelDuringRead), func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			client, err := New(Options{IndexerURL: "https://indexer.invalid"})
			if err != nil {
				t.Fatal(err)
			}
			client.http.Transport = metadataRoundTripFunc(func(r *http.Request) (*http.Response, error) {
				reader, writer := io.Pipe()
				if cancelDuringRead {
					cancel()
				}
				writer.CloseWithError(errors.New("response failed: https://indexer.invalid/?apikey=sentinel-secret"))

				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     make(http.Header),
					Body:       reader,
					Request:    r,
				}, nil
			})

			_, err = client.fetchTorrent(ctx, "https://indexer.invalid/?apikey=sentinel-secret")
			assertSafeTorrentError(t, err)
			if cancelDuringRead && !errors.Is(err, context.Canceled) {
				t.Fatalf("body error lost cancellation: %v", err)
			}
		})
	}

	t.Run("status", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "apikey=sentinel-secret", http.StatusUnauthorized)
		}))
		defer server.Close()

		client, err := New(Options{IndexerURL: server.URL})
		if err != nil {
			t.Fatal(err)
		}

		_, err = client.fetchTorrent(context.Background(), server.URL+"/?apikey=sentinel-secret")
		assertSafeTorrentError(t, err)
		if !strings.Contains(err.Error(), "status 401") {
			t.Fatalf("missing useful HTTP status: %v", err)
		}
	})
}
