package acquisition

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestWatchingRequestFallsBackToBookTitle(t *testing.T) {
	for _, primaryMatches := range []bool{false, true} {
		t.Run(fmt.Sprintf("primary_matches=%v", primaryMatches), func(t *testing.T) {
			testWatchingRequestSearch(t, primaryMatches)
		})
	}
}

func testWatchingRequestSearch(t *testing.T, primaryMatches bool) {
	t.Helper()
	const original = "Hunger Games 2 - Catching Fire Suzanne Collins"
	const fallback = "Catching Fire Suzanne Collins"
	var mu sync.Mutex
	var queries []string
	var downloads []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/indexer":
			query := r.URL.Query().Get("q")
			mu.Lock()
			queries = append(queries, query)
			mu.Unlock()
			if query == original && primaryMatches {
				fmt.Fprint(w, `<rss><channel><item><title>Hunger Games 2 - Catching Fire Suzanne Collins English M4B</title><enclosure url="https://download.test/audio" length="334495744"/></item></channel></rss>`)
			} else if query == original {
				fmt.Fprint(w, `<rss><channel><item><title>Hunger Games EPUB</title><enclosure url="https://download.test/ebook" length="500"/></item></channel></rss>`)
			} else if query == fallback {
				fmt.Fprint(w, `<rss><channel>
     <item><title>Catching Fire Suzanne Collins English M4B</title><enclosure url="https://download.test/audio" length="334495744"/></item>
     <item><title>Mockingjay Suzanne Collins English M4B</title><enclosure url="https://download.test/wrong-book" length="500"/></item>
     <item><title>Catching Fire Someone Else English M4B</title><enclosure url="https://download.test/wrong-author" length="500"/></item>
    </channel></rss>`)
			} else {
				http.Error(w, "unexpected query", 400)
			}
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			fmt.Fprint(w, "Ok.")
		case "/api/v2/torrents/add":
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			mu.Lock()
			downloads = append(downloads, r.FormValue("urls"))
			mu.Unlock()
			fmt.Fprint(w, "Ok.")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	db := titleLifecycleFixture(t)
	_, err := db.Exec(`UPDATE title_requests SET title='Hunger Games 2 - Catching Fire',author='Suzanne Collins' WHERE id='title';
 UPDATE title_request_formats SET format='audiobook',state='awaiting_release',next_search_at='2026-01-01',legacy_acquisition_request_id=NULL WHERE title_request_id='title';
 INSERT INTO acquisition_policies(library_id,default_audiobook_source_id,updated_at) VALUES('library','source','2026-01-01')`)
	if err != nil {
		t.Fatal(err)
	}
	client, err := New(Options{IndexerURL: server.URL + "/indexer", QBitURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	legacy := NewStore(db, client)
	// Metadata is irrelevant to query fallback; keep this test fully offline.
	for _, query := range []string{original, fallback} {
		legacy.metadataCache[strings.Join(normalizedWords(query), " ")] = cachedMetadata{expires: time.Now().Add(time.Hour)}
	}
	store := NewTitleRequestStore(db)
	store.SetAcquisitionStore(legacy)
	if err := store.Poll(context.Background()); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	expectedQueries := []string{original, fallback}
	if primaryMatches {
		expectedQueries = []string{original}
	}
	if !slices.Equal(queries, expectedQueries) {
		t.Fatalf("queries=%v", queries)
	}
	if !slices.Equal(downloads, []string{"https://download.test/audio"}) {
		t.Fatalf("downloads=%v", downloads)
	}
	var title, state string
	if err := db.QueryRow(`SELECT t.title,f.state FROM title_requests t JOIN title_request_formats f ON f.title_request_id=t.id WHERE t.id='title'`).Scan(&title, &state); err != nil {
		t.Fatal(err)
	}
	if title != "Hunger Games 2 - Catching Fire" || state != "downloading" {
		t.Fatalf("title=%q state=%q", title, state)
	}
}

func TestSeriesBookTitleIsConservative(t *testing.T) {
	for _, tc := range []struct{ input, title, volume string }{
		{"Hunger Games 2 - Catching Fire", "Catching Fire", "2"},
		{"The Hunger Games Book 2: Catching Fire", "Catching Fire", "2"},
		{"Hunger Games 2 — Catching Fire", "Catching Fire", "2"},
		{"1984", "", ""},
		{"2001: A Space Odyssey", "", ""},
		{"Catching Fire: A Novel", "", ""},
		{"Hunger Games - Catching Fire", "", ""},
		{"Heartstopper Volume 2", "", ""},
	} {
		t.Run(tc.input, func(t *testing.T) {
			title, volume := seriesBookTitle(tc.input)
			if title != tc.title || volume != tc.volume {
				t.Fatalf("got %q/%q", title, volume)
			}
		})
	}
}

func TestFallbackBookRejectsUnrelatedReleases(t *testing.T) {
	for _, tc := range []struct {
		title string
		want  bool
	}{
		{"Catching Fire Suzanne Collins English M4B", true},
		{"Suzanne Collins - The Hunger Games Book 2 - Catching Fire MP3", true},
		{"Mockingjay Suzanne Collins English M4B", false},
		{"Catching Fire Another Author M4B", false},
		{"Catching Fire M4B", false},
		{"Hunger Games 3 - Catching Fire Suzanne Collins M4B", false},
		{"Catching Fire Suzanne Collins Book 3 M4B", false},
	} {
		t.Run(tc.title, func(t *testing.T) {
			if got := matchesFallbackBook(SearchResult{Title: tc.title}, "Catching Fire", "Suzanne Collins", "2"); got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}
