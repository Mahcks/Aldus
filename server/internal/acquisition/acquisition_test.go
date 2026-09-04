package acquisition

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
	"time"
)

func TestSearchAndAdd(t *testing.T) {
	var added string
	var requestError string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v2/") && (r.Header.Get("Origin") != server.URL || r.Header.Get("Referer") != server.URL+"/") {
			http.Error(w, "invalid origin", http.StatusForbidden)
			return
		}
		switch r.URL.Path {
		case "/indexer":
			if r.URL.Query().Get("q") != "Alice Carroll" || r.URL.Query().Get("apikey") != "secret" || r.URL.Query().Get("cat") != "3030,7000" {
				requestError = "missing encoded search parameters"
			}
			_, _ = w.Write([]byte(`<rss><channel><item><title>Alice EPUB</title><enclosure url="https://download.test/alice" length="123"/></item></channel></rss>`))
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/categories":
			_, _ = w.Write([]byte(`{}`))
		case "/api/v2/torrents/createCategory":
			_ = r.ParseForm()
			if r.FormValue("category") != "aldus" {
				requestError = "missing qBittorrent category"
			}
		case "/api/v2/torrents/add":
			if cookie, _ := r.Cookie("SID"); cookie == nil || cookie.Value != "session" {
				requestError = "missing qBittorrent session"
			}
			_ = r.ParseMultipartForm(1024)
			added = r.FormValue("urls") + ":" + r.FormValue("category") + ":" + r.FormValue("tags")
			_, _ = w.Write([]byte("Ok."))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, err := New(Options{IndexerURL: server.URL + "/indexer", IndexerAPIKey: "secret", QBitURL: server.URL, Category: "aldus"})
	if err != nil {
		t.Fatal(err)
	}
	results, err := client.Search(context.Background(), " Alice Carroll ")
	if err != nil || len(results) != 1 || results[0].Title != "Alice EPUB" || results[0].Size != 123 {
		t.Fatalf("results=%+v err=%v", results, err)
	}
	if _, err := client.addTracked(context.Background(), results[0].DownloadURL, "request_123"); err != nil {
		t.Fatal(err)
	}
	if added != "https://download.test/alice:aldus:request_123" {
		t.Fatalf("added=%q", added)
	}
	if requestError != "" {
		t.Fatal(requestError)
	}
}

func TestAddTrackedUploadsIndexerTorrentInsteadOfLeavingQBitPending(t *testing.T) {
	const torrent = "d4:infod4:name4:bookee"
	var uploaded string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/download":
			if r.Header.Get("X-Api-Key") != "secret" {
				http.Error(w, "missing API key", http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(torrent))
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/categories":
			_, _ = w.Write([]byte(`{"aldus":{}}`))
		case "/api/v2/torrents/add":
			file, _, err := r.FormFile("torrents")
			if err != nil {
				t.Errorf("torrent upload missing: %v", err)
				return
			}
			defer file.Close()
			body, _ := io.ReadAll(file)
			uploaded = string(body)
			if r.FormValue("urls") != "" || r.FormValue("tags") != "request_123" {
				t.Errorf("unexpected add form: urls=%q tags=%q", r.FormValue("urls"), r.FormValue("tags"))
			}
			_, _ = w.Write([]byte(`{"added_torrent_ids":["abc"],"failure_count":0,"pending_count":0,"success_count":1}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := New(Options{IndexerURL: server.URL, IndexerAPIKey: "secret", QBitURL: server.URL, Category: "aldus"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.addTracked(context.Background(), server.URL+"/download", "request_123"); err != nil {
		t.Fatal(err)
	}
	if uploaded != torrent {
		t.Fatalf("uploaded %q", uploaded)
	}
}

func TestAddTrackedPassesIndexerMagnetRedirectToQBit(t *testing.T) {
	const magnet = "magnet:?xt=urn:btih:2f969ff125dc4f6ec0b7ffd82c11a4bea561f419"
	var added string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/download":
			http.Redirect(w, r, magnet, http.StatusFound)
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/categories":
			_, _ = w.Write([]byte(`{"aldus":{}}`))
		case "/api/v2/torrents/add":
			added = r.FormValue("urls")
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"added_torrent_ids":[],"failure_count":0,"pending_count":1,"success_count":0}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := New(Options{IndexerURL: server.URL, QBitURL: server.URL, Category: "aldus"})
	if err != nil {
		t.Fatal(err)
	}
	hash, err := client.addTracked(context.Background(), server.URL+"/download", "request_123")
	if err != nil {
		t.Fatal(err)
	}
	if added != magnet {
		t.Fatalf("added %q", added)
	}
	if hash != "2f969ff125dc4f6ec0b7ffd82c11a4bea561f419" {
		t.Fatalf("hash %q", hash)
	}
}

func TestRemoveTag(t *testing.T) {
	var removed bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/removeTags":
			_ = r.ParseForm()
			removed = r.Form.Get("hashes") == "hash" && r.Form.Get("tags") == "request_123"
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, _ := New(Options{QBitURL: server.URL})
	if err := client.RemoveTag(context.Background(), "hash", "request_123"); err != nil || !removed {
		t.Fatalf("removed=%v err=%v", removed, err)
	}
}

func TestSearchOnlyReturnsSupportedBookAndAudiobookReleases(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<rss><channel>
			<item><title>A Movie 2160p BDRip</title><link>https://download.test/movie</link></item>
			<item><title>A Book EPUB MOBI</title><link>https://download.test/book</link></item>
			<item><title>An Audiobook M4B</title><link>https://download.test/audio</link></item>
			<item><title>A Cookbook PDF</title><link>https://download.test/pdf</link></item>
		</channel></rss>`))
	}))
	defer server.Close()
	client, _ := New(Options{IndexerURL: server.URL})
	results, err := client.Search(context.Background(), "book")
	if err != nil || len(results) != 2 || results[0].Title != "A Book EPUB MOBI" || results[1].Title != "An Audiobook M4B" {
		t.Fatalf("results=%+v err=%v", results, err)
	}
}

func TestProwlarrDiscoversAndSearchesEnabledIndexers(t *testing.T) {
	var searched atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-Key") != "prowlarr-key" && r.URL.Query().Get("apikey") != "prowlarr-key" {
			http.Error(w, "missing API key", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/v1/indexer":
			_, _ = w.Write([]byte(`[{"id":1,"name":"Books","protocol":"torrent","enable":true},{"id":2,"name":"Audio","protocol":"torrent","enable":true},{"id":3,"name":"Usenet","protocol":"usenet","enable":true},{"id":4,"name":"Disabled","protocol":"torrent","enable":false}]`))
		case "/1/api", "/2/api":
			searched.Add(1)
			_, _ = w.Write([]byte(`<rss><channel><item><title>Alice EPUB</title><enclosure url="magnet:?xt=urn:btih:abcdef" length="123"/></item></channel></rss>`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, _ := New(Options{IndexerKind: "prowlarr", IndexerURL: server.URL, IndexerAPIKey: "prowlarr-key"})
	results, err := client.Search(context.Background(), "Alice")
	if err != nil || len(results) != 2 || searched.Load() != 2 {
		t.Fatalf("results=%+v searched=%d err=%v", results, searched.Load(), err)
	}
	if results[0].Source == "Disabled" || results[1].Source == "Disabled" {
		t.Fatalf("disabled indexer searched: %+v", results)
	}
}

func TestStoreAuthorizesEditorsAndBindsSelectionsToSearchResults(t *testing.T) {
	ctx := context.Background()
	var added, addedTag string
	var addCount int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/indexer":
			w.Write([]byte(`<rss><channel><item><title>Alice EPUB</title><enclosure url="https://download.test/alice" length="123"/></item></channel></rss>`))
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/add":
			addCount++
			_ = r.ParseMultipartForm(1024)
			added = r.FormValue("urls")
			addedTag = r.FormValue("tags")
			_, _ = w.Write([]byte("Ok."))
		}
	}))
	defer server.Close()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('editor','editor','editor','Editor','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),('reader','reader','reader','Reader','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('library','editor','editor','2026-01-01T00:00:00Z'),('library','reader','reader','2026-01-01T00:00:00Z'); INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('source','library','local','Downloads','/downloads',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	client, _ := New(Options{IndexerURL: server.URL + "/indexer", QBitURL: server.URL})
	store := NewStore(db, client)
	editor := auth.User{ID: "editor"}
	discovery, err := store.Discover(ctx, editor, "library", "source", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.List(ctx, auth.User{ID: "reader"}, "library"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reader list error = %v", err)
	}
	requests, err := store.List(ctx, editor, "library")
	if err != nil || len(requests) != 0 || len(discovery.Results) != 1 {
		t.Fatalf("ephemeral discovery = %#v, requests=%#v, %v", discovery, requests, err)
	}
	if _, err := store.SelectDiscovery(ctx, editor, "library", discovery.ID, "client-invented"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("tampered selection error = %v", err)
	}
	selected, err := store.SelectDiscovery(ctx, editor, "library", discovery.ID, discovery.Results[0].ID)
	if err != nil || selected.Status != "queued" || added != "https://download.test/alice" || addedTag != selected.ID {
		t.Fatalf("selected = %#v, added=%q, tag=%q, err=%v", selected, added, addedTag, err)
	}
	if _, err := store.SelectDiscovery(ctx, editor, "library", discovery.ID, discovery.Results[0].ID); !errors.Is(err, ErrNotFound) || addCount != 1 {
		t.Fatalf("repeated selection err=%v add count=%d", err, addCount)
	}
	if _, err := db.Exec(`UPDATE library_members SET can_request_acquisitions=1 WHERE library_id='library' AND user_id='reader'`); err != nil {
		t.Fatal(err)
	}
	reader := auth.User{ID: "reader"}
	requested, err := store.Create(ctx, reader, "library", "source", "A Wizard of Earthsea")
	if err != nil {
		t.Fatal(err)
	}
	tracker, err := store.Tracker(ctx, reader)
	if err != nil || tracker.UnreadCount != 1 || len(tracker.Requests) != 1 || tracker.Requests[0].ID != requested.ID {
		t.Fatalf("reader tracker = %#v, %v", tracker, err)
	}
	if err := store.MarkTrackerSeen(ctx, reader); err != nil {
		t.Fatal(err)
	}
	tracker, _ = store.Tracker(ctx, reader)
	if tracker.UnreadCount != 0 {
		t.Fatalf("seen tracker = %#v", tracker)
	}
}

func TestPairedDiscoveryPersistsIntentBeforeSubmittingBothHalves(t *testing.T) {
	ctx := context.Background()
	var adds int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/add":
			adds++
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
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('editor','editor','editor','Editor','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('library','editor','editor','2026-01-01T00:00:00Z'); INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('source','library','local','Downloads','/downloads',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	client, _ := New(Options{QBitURL: server.URL})
	store := NewStore(db, client)
	store.discoveries["discovery"] = discoverySession{LibraryID: "library", SourceID: "source", Query: "Alice", UserID: "editor", ExpiresAt: time.Now().Add(time.Minute), Results: map[string]selectedDiscoveryResult{
		"ebook": {Download: Result{Title: "Alice EPUB", DownloadURL: "https://download.test/ebook"}, Metadata: SearchResult{ID: "ebook", Kind: "ebook", CanonicalTitle: "Alice's Adventures in Wonderland", Author: "Lewis Carroll", ISBN: "isbn", Year: 1865, CoverURL: "https://covers.test/alice.jpg", LikelyPairIDs: []string{"audio"}}},
		"audio": {Download: Result{Title: "Alice M4B", DownloadURL: "https://download.test/audio"}, Metadata: SearchResult{ID: "audio", Kind: "audiobook", CanonicalTitle: "Alice's Adventures in Wonderland", Author: "Lewis Carroll", LikelyPairIDs: []string{"ebook"}}},
	}}
	pair, err := store.SelectPairDiscovery(ctx, auth.User{ID: "editor"}, "library", "discovery", []string{"ebook", "audio"})
	if err != nil || len(pair.Requests) != 2 || adds != 2 || pair.Requests[0].PairID != pair.ID || pair.Requests[1].PairID != pair.ID {
		t.Fatalf("pair = %#v, adds=%d, err=%v", pair, adds, err)
	}
	var title, isbn, source string
	if err := db.QueryRow(`SELECT advisory_title,advisory_isbn,advisory_source FROM acquisition_requests WHERE pair_id=? AND advisory_isbn!=''`, pair.ID).Scan(&title, &isbn, &source); err != nil || title != "Alice's Adventures in Wonderland" || isbn != "isbn" || source != "open_library" {
		t.Fatalf("advisory metadata = %q %q %q, %v", title, isbn, source, err)
	}
}

func TestFailedAcquisitionRetriesCancelsAndDismissesWithoutDuplicateDownload(t *testing.T) {
	ctx := context.Background()
	active, tagged, rejectDelete := false, false, false
	reportedHash, deletedHash, deleteFiles := "hash", "", ""
	adds, deletes := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/categories":
			_, _ = w.Write([]byte(`{"aldus":{}}`))
		case "/api/v2/torrents/info":
			if r.URL.Query().Get("category") != "aldus" {
				t.Errorf("category = %q", r.URL.Query().Get("category"))
			}
			if active {
				tag := ""
				if tagged {
					tag = "request"
				}
				_, _ = w.Write([]byte(`[{"hash":"other","tags":"other","state":"downloading","progress":0.5},{"hash":"` + reportedHash + `","tags":"` + tag + `","state":"downloading","progress":0.5}]`))
			} else {
				_, _ = w.Write([]byte(`[]`))
			}
		case "/api/v2/torrents/add":
			adds++
			active = true
			tagged = true
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/removeTags":
			if r.FormValue("hashes") != reportedHash || r.FormValue("tags") != "request" {
				t.Errorf("remove tag form = %#v", r.Form)
			}
			tagged = false
		case "/api/v2/torrents/delete":
			deletes++
			deletedHash = r.FormValue("hashes")
			deleteFiles = r.FormValue("deleteFiles")
			if rejectDelete {
				http.Error(w, "no", http.StatusBadGateway)
				return
			}
			active = false
			tagged = false
			w.WriteHeader(http.StatusOK)
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
	_, err = db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('reader','reader','reader','Reader','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),('other','other','other','Other','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO library_members(library_id,user_id,role,can_request_acquisitions,created_at) VALUES('library','reader','reader',1,'2026-01-01T00:00:00Z'),('library','other','reader',1,'2026-01-01T00:00:00Z'); INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('source','library','local','Downloads','/downloads',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,selected_title,selected_url,download_state,download_error,fulfillment_state,created_at,updated_at) VALUES('request','library','reader','source','Alice','requested','Alice','https://download.test/alice','','','submitting','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	client, _ := New(Options{QBitURL: server.URL, Category: "aldus"})
	store := NewStore(db, client)
	store.SetHandoff(func(context.Context, string, string, string, string) (string, error) { return "", nil })
	store.markDownloadProblem(ctx, "request", "download client unavailable")
	var failedState, diagnosis string
	if err := db.QueryRow(`SELECT fulfillment_state,download_error FROM acquisition_requests WHERE id='request'`).Scan(&failedState, &diagnosis); err != nil || failedState != "failed" || diagnosis != "download client unavailable" {
		t.Fatalf("failed state=%q diagnosis=%q err=%v", failedState, diagnosis, err)
	}
	reader := auth.User{ID: "reader"}
	if err := store.Retry(ctx, auth.User{ID: "other"}, "library", "request"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user retry = %v", err)
	}
	if err := store.Retry(ctx, reader, "library", "request"); err != nil || adds != 1 {
		t.Fatalf("retry adds=%d err=%v", adds, err)
	}
	if err := store.Cancel(ctx, reader, "library", "request"); err != nil || deletes != 1 || deletedHash != "hash" || deleteFiles != "true" {
		t.Fatalf("pre-hash cancel deletes=%d hash=%q deleteFiles=%q err=%v", deletes, deletedHash, deleteFiles, err)
	}
	if err := store.Retry(ctx, reader, "library", "request"); err != nil || adds != 2 {
		t.Fatalf("retry after cancel adds=%d err=%v", adds, err)
	}
	if err := store.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	var torrentHash string
	if err := db.QueryRow(`SELECT torrent_hash FROM acquisition_requests WHERE id='request'`).Scan(&torrentHash); err != nil || torrentHash != "hash" || !active || tagged {
		t.Fatalf("poll hash=%q active=%t tagged=%t err=%v", torrentHash, active, tagged, err)
	}
	if err := store.Cancel(ctx, auth.User{ID: "other"}, "library", "request"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user cancel = %v", err)
	}
	reportedHash = "HASH"
	rejectDelete = true
	if err := store.Cancel(ctx, reader, "library", "request"); err == nil || deletes != 2 {
		t.Fatalf("failed cancel deletes=%d err=%v", deletes, err)
	}
	assertAcquisitionState(t, db, "request", "downloading", "")
	if !active {
		t.Fatal("failed delete removed download")
	}
	rejectDelete = false
	if err := store.Cancel(ctx, reader, "library", "request"); err != nil || deletes != 3 || deletedHash != "HASH" || deleteFiles != "true" {
		t.Fatalf("hash cancel deletes=%d hash=%q deleteFiles=%q err=%v", deletes, deletedHash, deleteFiles, err)
	}
	if err := store.Cancel(ctx, reader, "library", "request"); !errors.Is(err, ErrInvalid) || deletes != 3 {
		t.Fatalf("repeated cancel deletes=%d err=%v", deletes, err)
	}
	if err := store.Retry(ctx, reader, "library", "request"); err != nil || adds != 3 {
		t.Fatalf("retry before missing cancel adds=%d err=%v", adds, err)
	}
	active = false
	tagged = false
	if _, err := db.Exec(`UPDATE acquisition_requests SET torrent_hash='missing' WHERE id='request'`); err != nil {
		t.Fatal(err)
	}
	if err := store.Cancel(ctx, reader, "library", "request"); err != nil || deletes != 3 {
		t.Fatalf("missing cancel deletes=%d err=%v", deletes, err)
	}
	if err := store.Dismiss(ctx, reader, "library", "request"); err != nil {
		t.Fatal(err)
	}
	tracker, err := store.Tracker(ctx, reader)
	if err != nil || len(tracker.Requests) != 0 {
		t.Fatalf("dismissed tracker = %#v, %v", tracker, err)
	}
}

func TestAcquisitionSettingsAreAdminOnlyAndPreserveBlankSecrets(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	client, _ := New(Options{IndexerAPIKey: "environment-key", QBitPassword: "environment-password", Category: "aldus"})
	store := NewStore(db, client)
	if _, err := store.Settings(ctx, auth.User{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-admin settings error = %v", err)
	}
	admin := auth.User{Admin: true}
	settings, err := store.UpdateSettings(ctx, admin, SettingsUpdate{IndexerURL: "https://indexer.example/api", QBitURL: "https://qbit.example", QBitUsername: "aldus", QBitCategory: "books"})
	if err != nil || !settings.HasIndexerAPIKey || !settings.HasQBitPassword || settings.QBitCategory != "books" {
		t.Fatalf("settings = %#v, %v", settings, err)
	}
	var indexerKey, qbitPassword string
	if err := db.QueryRow(`SELECT indexer_api_key,qbittorrent_password FROM acquisition_settings WHERE id=1`).Scan(&indexerKey, &qbitPassword); err != nil {
		t.Fatal(err)
	}
	if indexerKey != "environment-key" || qbitPassword != "environment-password" {
		t.Fatalf("preserved secrets = %q, %q", indexerKey, qbitPassword)
	}
}

func TestCompletedDownloadStartsSafeHandoffOnce(t *testing.T) {
	ctx := context.Background()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/info":
			_, _ = w.Write([]byte(`[{"hash":"hash","name":"Alice","state":"uploading","content_path":"/downloads/Alice","tags":"request","progress":1,"size":100}]`))
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
	_, err = db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('source','library','local','Downloads','/library/downloads',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,download_state,fulfillment_state,created_at,updated_at) VALUES('request','library','admin','source','Alice','queued','downloading','downloading','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	client, _ := New(Options{QBitURL: server.URL, Category: "aldus", DownloadRoot: "/downloads"})
	store := NewStore(db, client)
	var handoffs int
	store.SetHandoff(func(_ context.Context, libraryID, sourceID, requestID, path string) (string, error) {
		handoffs++
		if libraryID != "library" || sourceID != "source" || requestID != "request" || path != "/library/downloads/Alice" {
			t.Fatalf("handoff = %q %q %q %q", libraryID, sourceID, requestID, path)
		}
		if _, err := db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at,acquisition_request_id) VALUES('scan','source','pending','2026-01-01T00:00:00Z','request')`); err != nil {
			t.Fatal(err)
		}
		return "scan", nil
	})
	if err := store.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	if err := store.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	var state string
	if err := db.QueryRow(`SELECT fulfillment_state FROM acquisition_requests WHERE id='request'`).Scan(&state); err != nil || state != "scanning" || handoffs != 1 {
		t.Fatalf("state=%q handoffs=%d err=%v", state, handoffs, err)
	}
}

func TestCompletedPairClosesRowsBeforeHandoff(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('reader','reader','reader','Reader','x',0,0,'2026-01-01','2026-01-01');
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01','2026-01-01');
		INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('work','library','Alice','2026-01-01','2026-01-01');
		INSERT INTO representations(id,work_id,kind,label,created_at,updated_at) VALUES('epub-rep','work','epub','EPUB','2026-01-01','2026-01-01'),('audio-rep','work','audio','Audio','2026-01-01','2026-01-01');
		INSERT INTO media(id,representation_id,kind,path,sha256,created_at) VALUES('epub-media','epub-rep','epub','book.epub','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-01-01'),('audio-media','audio-rep','audio','book.mp3','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','2026-01-01');
		INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('source','library','local','Media','/media',1,'2026-01-01','2026-01-01');
		INSERT INTO source_entries(id,source_id,relative_path,size_bytes,modified_at,state,created_at,updated_at) VALUES('epub-entry','source','book.epub',1,'2026-01-01','registered','2026-01-01','2026-01-01'),('audio-entry','source','book.mp3',1,'2026-01-01','registered','2026-01-01','2026-01-01');
		INSERT INTO media_locations(media_id,source_entry_id,created_at) VALUES('epub-media','epub-entry','2026-01-01'),('audio-media','audio-entry','2026-01-01');
		INSERT INTO import_groups(id,library_id,logical_key,content_key,state,confidence,proposed_title,normalized_title,created_at,updated_at) VALUES('epub-proposal','library','epub','epub','obsolete','high','Alice','alice','2026-01-01','2026-01-01'),('audio-proposal','library','audio','audio','obsolete','high','Alice','alice','2026-01-01','2026-01-01');
		INSERT INTO import_items(group_id,source_entry_id,representation_kind,proposed_label) VALUES('epub-proposal','epub-entry','epub','EPUB'),('audio-proposal','audio-entry','audiobook','Audio');
		INSERT INTO acquisition_pairs(id,library_id,requested_by,query,work_id,created_at,updated_at) VALUES('pair','library','reader','Alice','work','2026-01-01','2026-01-01');
		INSERT INTO acquisition_requests(id,library_id,requested_by,query,status,fulfillment_state,proposal_id,work_id,pair_id,created_at,updated_at) VALUES('epub-request','library','reader','Alice','queued','available','epub-proposal','work','pair','2026-01-01','2026-01-01'),('audio-request','library','reader','Alice','queued','available','audio-proposal','work','pair','2026-01-01','2026-01-01');`)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(db, nil)
	handedOff := false
	store.SetPairHandoff(func(ctx context.Context, pair ReadyPair) error {
		var count int
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM media`).Scan(&count); err != nil {
			return err
		}
		if pair.ID != "pair" || pair.RequestedBy != "reader" || count != 2 {
			t.Fatalf("handoff = %#v, media=%d", pair, count)
		}
		handedOff = true
		return nil
	})
	reconcileCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	if err := store.reconcileFulfillment(reconcileCtx); err != nil {
		t.Fatal(err)
	}
	if !handedOff {
		t.Fatal("paired acquisition was not handed off")
	}
}

func TestFulfillmentTracksExactScanProposalAndAcceptedWork(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('source','library','local','Downloads','/library/downloads',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,download_state,fulfillment_state,completed_relative_path,advisory_cover_id,advisory_cover_url,advisory_description,advisory_source,created_at,updated_at) VALUES('request','library','admin','source','Alice','queued','downloading','scanning','Alice','42','https://covers.openlibrary.org/b/id/42-M.jpg?default=false','A curious adventure.','open_library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO source_scans(id,source_id,state,created_at,finished_at,acquisition_request_id) VALUES('scan','source','completed','2026-01-01T00:00:00Z','2026-01-01T00:01:00Z','request');
		UPDATE acquisition_requests SET scan_id='scan' WHERE id='request';
		INSERT INTO source_entries(id,source_id,relative_path,size_bytes,modified_at,sha256,state,created_at,updated_at,detected_kind,last_seen_scan_id) VALUES('entry','source','Alice/book.epub',10,'2026-01-01T00:00:00Z','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','registered','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','epub','scan');
		INSERT INTO import_groups(id,library_id,logical_key,content_key,state,confidence,proposed_title,proposed_author,normalized_title,normalized_author,reasons_json,revision,created_at,updated_at) VALUES('proposal','library','logical','content','proposed','high','Alice','Author','alice','author','[]',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO import_items(group_id,source_entry_id,representation_kind,proposed_label,evidence_json) VALUES('proposal','entry','epub','EPUB','{}');
		INSERT INTO acquisition_import_outcomes(acquisition_request_id,scan_id,state,proposal_id,reason,updated_at) VALUES('request','scan','needs_review','proposal','Review required.','2026-01-01T00:01:00Z');`)
	if err != nil {
		t.Fatal(err)
	}
	client, _ := New(Options{})
	store := NewStore(db, client)
	if err := store.reconcileFulfillment(ctx); err != nil {
		t.Fatal(err)
	}
	var state, proposalID string
	if err := db.QueryRow(`SELECT fulfillment_state,COALESCE(proposal_id,'') FROM acquisition_requests WHERE id='request'`).Scan(&state, &proposalID); err != nil || state != "needs_review" || proposalID != "proposal" {
		t.Fatalf("after scan state=%q proposal=%q err=%v", state, proposalID, err)
	}
	_, err = db.Exec(`INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('work','library','Alice','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); UPDATE import_groups SET decision='accepted',accepted_work_id='work',state='obsolete' WHERE id='proposal'; UPDATE acquisition_import_outcomes SET state='accepted',accepted_work_id='work',reason='' WHERE acquisition_request_id='request'`)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.reconcileFulfillment(ctx); err != nil {
		t.Fatal(err)
	}
	var workID string
	if err := db.QueryRow(`SELECT fulfillment_state,COALESCE(work_id,'') FROM acquisition_requests WHERE id='request'`).Scan(&state, &workID); err != nil || state != "available" || workID != "work" {
		t.Fatalf("after acceptance state=%q work=%q err=%v", state, workID, err)
	}
	var readingStatus string
	if err := db.QueryRow(`SELECT status FROM user_work_statuses WHERE user_id='admin' AND work_id='work'`).Scan(&readingStatus); err != nil || readingStatus != "want_to_read" {
		t.Fatalf("acquired work status=%q err=%v", readingStatus, err)
	}
	var coverURL, description string
	if err := db.QueryRow(`SELECT c.image_url,m.description FROM works w JOIN work_covers c ON c.id=w.selected_cover_id JOIN work_metadata m ON m.work_id=w.id WHERE w.id='work'`).Scan(&coverURL, &description); err != nil || coverURL != "https://covers.openlibrary.org/b/id/42-M.jpg?default=false" || description != "A curious adventure." {
		t.Fatalf("acquired metadata cover=%q description=%q err=%v", coverURL, description, err)
	}
}

func TestFulfillmentReviewsAmbiguousAndRejectsIgnoredImportProposals(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('source','library','local','Downloads','/library/downloads',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,download_state,fulfillment_state,completed_relative_path,created_at,updated_at) VALUES('request','library','admin','source','Books','queued','downloading','scanning','Books','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO source_scans(id,source_id,state,created_at,finished_at,acquisition_request_id) VALUES('scan','source','completed','2026-01-01T00:00:00Z','2026-01-01T00:01:00Z','request');
		UPDATE acquisition_requests SET scan_id='scan' WHERE id='request';
		INSERT INTO source_entries(id,source_id,relative_path,size_bytes,modified_at,sha256,state,created_at,updated_at,detected_kind,last_seen_scan_id) VALUES
			('entry-one','source','Books/one.epub',10,'2026-01-01T00:00:00Z','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','registered','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','epub','scan'),
			('entry-two','source','Books/two.epub',10,'2026-01-01T00:00:00Z','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','registered','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','epub','scan');
		INSERT INTO import_groups(id,library_id,logical_key,content_key,state,confidence,proposed_title,proposed_author,normalized_title,normalized_author,reasons_json,revision,created_at,updated_at) VALUES
			('proposal-one','library','logical-one','content-one','proposed','high','One','Author','one','author','[]',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
			('proposal-two','library','logical-two','content-two','proposed','high','Two','Author','two','author','[]',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO import_items(group_id,source_entry_id,representation_kind,proposed_label,evidence_json) VALUES
			('proposal-one','entry-one','epub','EPUB','{}'),
			('proposal-two','entry-two','epub','EPUB','{}');
		INSERT INTO acquisition_import_outcomes(acquisition_request_id,scan_id,state,reason,updated_at) VALUES('request','scan','needs_review','Multiple books were found in the completed download; review the import proposals.','2026-01-01T00:01:00Z');`)
	if err != nil {
		t.Fatal(err)
	}
	client, _ := New(Options{})
	store := NewStore(db, client)
	if err := store.reconcileFulfillment(ctx); err != nil {
		t.Fatal(err)
	}
	var state, diagnosis string
	if err := db.QueryRow(`SELECT fulfillment_state,download_error FROM acquisition_requests WHERE id='request'`).Scan(&state, &diagnosis); err != nil || state != "needs_review" || !strings.Contains(diagnosis, "Multiple books") {
		t.Fatalf("ambiguous state=%q diagnosis=%q err=%v", state, diagnosis, err)
	}
	if _, err := db.Exec(`UPDATE acquisition_requests SET fulfillment_state='needs_review',proposal_id='proposal-one',download_error='' WHERE id='request'; UPDATE import_groups SET decision='ignored',state='obsolete' WHERE id='proposal-one'; UPDATE acquisition_import_outcomes SET state='failed',proposal_id='proposal-one',reason='The import proposal was dismissed during review.' WHERE acquisition_request_id='request'`); err != nil {
		t.Fatal(err)
	}
	if err := store.reconcileFulfillment(ctx); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT fulfillment_state,download_error FROM acquisition_requests WHERE id='request'`).Scan(&state, &diagnosis); err != nil || state != "failed" || !strings.Contains(diagnosis, "dismissed") {
		t.Fatalf("ignored state=%q diagnosis=%q err=%v", state, diagnosis, err)
	}
}

func TestSearchParsesTorznabAndNewznabFeeds(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<rss xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/"><channel>
			<item><title> Relative EPUB </title><pubDate>Fri, 15 Aug 2026 12:30:00 -0500</pubDate><enclosure url="/download/one"/><newznab:attr name="size" value="456"/></item>
			<item><title>Magnet audiobook</title><pubDate>Fri, 15 Aug 2026 17:30:00 GMT</pubDate><link>magnet:?xt=urn:btih:abcdef</link></item>
			<item><title>Unsafe</title><link>file:///etc/passwd</link></item>
		</channel></rss>`))
	}))
	defer server.Close()
	client, _ := New(Options{IndexerURL: server.URL + "/api"})
	results, err := client.Search(context.Background(), "alice")
	if err != nil || len(results) != 2 {
		t.Fatalf("results=%+v err=%v", results, err)
	}
	if results[0].Title != "Relative EPUB" || results[0].DownloadURL != server.URL+"/download/one" || results[0].Size != 456 {
		t.Fatalf("newznab result=%+v", results[0])
	}
	if results[0].Published.IsZero() || results[1].Published.IsZero() || results[1].DownloadURL != "magnet:?xt=urn:btih:abcdef" {
		t.Fatalf("dates/magnet=%+v", results)
	}
}

func TestSearchReturnsNewznabProtocolError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<error code="100" description="Incorrect user credentials"/>`))
	}))
	defer server.Close()
	client, _ := New(Options{IndexerURL: server.URL})
	if _, err := client.Search(context.Background(), "alice"); err == nil || !strings.Contains(err.Error(), "protocol error 100") {
		t.Fatalf("err=%v", err)
	}
}

func TestSearchTransportErrorDoesNotExposeAPIKey(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	indexerURL := server.URL
	server.Close()
	client, _ := New(Options{IndexerURL: indexerURL, IndexerAPIKey: "do-not-leak"})
	_, err := client.Search(context.Background(), "alice")
	if err == nil || strings.Contains(err.Error(), "do-not-leak") || strings.Contains(err.Error(), "apikey") {
		t.Fatalf("unsafe search error: %v", err)
	}
}

func TestQBitTorrentDownloadsDefineImportHandoff(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/info":
			if r.URL.Query().Get("category") != "aldus" {
				http.Error(w, "missing category", http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`[
				{"hash":"one","name":"Done","state":"pausedUP","content_path":"/downloads/done","tags":"other, request_123","progress":1,"size":100},
				{"hash":"two","name":"Working","state":"downloading","content_path":"/downloads/working","progress":0.5,"size":200},
				{"hash":"three","name":"Checking","state":"checkingUP","content_path":"/downloads/checking","progress":1,"size":300}
			]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, _ := New(Options{QBitURL: server.URL, Category: "aldus"})
	downloads, err := client.Downloads(context.Background())
	if err != nil || len(downloads) != 3 {
		t.Fatalf("downloads=%+v err=%v", downloads, err)
	}
	if !downloads[0].ReadyForImport() || !downloads[0].HasTag("request_123") || downloads[0].HasTag("request_12") || downloads[1].ReadyForImport() || downloads[2].ReadyForImport() {
		t.Fatalf("import readiness=%+v", downloads)
	}
}

func TestQBitTorrentRejectsProtocolLevelFailures(t *testing.T) {
	for _, test := range []struct {
		name, loginBody, addBody string
		cookie                   bool
	}{
		{name: "login body", loginBody: "Fails."},
		{name: "missing session", loginBody: "Ok."},
		{name: "add body", loginBody: "Ok.", cookie: true, addBody: "Fails."},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/v2/auth/login" {
					if test.cookie {
						http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
					}
					_, _ = w.Write([]byte(test.loginBody))
					return
				}
				_, _ = w.Write([]byte(test.addBody))
			}))
			defer server.Close()
			client, _ := New(Options{QBitURL: server.URL})
			if _, err := client.addTracked(context.Background(), "magnet:?xt=urn:btih:abcdef", ""); err == nil {
				t.Fatal("accepted qBittorrent failure response")
			}
		})
	}
}

func TestQBitTorrentAcceptsAcceptedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/add":
			w.WriteHeader(http.StatusAccepted)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, _ := New(Options{QBitURL: server.URL})
	if _, err := client.addTracked(context.Background(), "magnet:?xt=urn:btih:abcdef", ""); err != nil {
		t.Fatal(err)
	}
}

func TestQBitTorrentAddReceipts(t *testing.T) {
	for _, test := range []struct {
		name, body string
		wantErr    bool
	}{
		{name: "legacy empty"},
		{name: "legacy ok", body: "Ok."},
		{name: "pending", body: `{"added_torrent_ids":[],"failure_count":0,"pending_count":1,"success_count":0}`, wantErr: true},
		{name: "success", body: `{"added_torrent_ids":["abc"],"failure_count":0,"pending_count":0,"success_count":1}`},
		{name: "all failed", body: `{"added_torrent_ids":[],"failure_count":1,"pending_count":0,"success_count":0}`, wantErr: true},
		{name: "empty contradiction", body: `{"added_torrent_ids":[],"failure_count":0,"pending_count":0,"success_count":0}`, wantErr: true},
		{name: "missing counts", body: `{"pending_count":1}`, wantErr: true},
		{name: "not json", body: "accepted", wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := acceptedAddResponse(test.body); (err != nil) != test.wantErr {
				t.Fatalf("acceptedAddResponse(%q) error = %v", test.body, err)
			}
		})
	}
}

func TestSubmissionRecoveryWaitsBeforeResubmitting(t *testing.T) {
	ctx := context.Background()
	var adds atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/info":
			_, _ = w.Write([]byte(`[]`))
		case "/api/v2/torrents/add":
			adds.Add(1)
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
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('reader','reader','reader','Reader','x',0,0,?,?);
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library',?,?);
		INSERT INTO acquisition_requests(id,library_id,requested_by,query,status,selected_url,fulfillment_state,created_at,updated_at) VALUES('request','library','reader','Alice','requested','https://download.test/alice','submitting',?,?)`, now, now, now, now, now, now); err != nil {
		t.Fatal(err)
	}
	client, _ := New(Options{QBitURL: server.URL})
	store := NewStore(db, client)
	if err := store.recoverSubmissions(ctx); err != nil || adds.Load() != 0 {
		t.Fatalf("recent recovery adds=%d err=%v", adds.Load(), err)
	}
	old := time.Now().UTC().Add(-16 * time.Minute).Format(time.RFC3339Nano)
	if _, err := db.Exec(`UPDATE acquisition_requests SET updated_at=? WHERE id='request'`, old); err != nil {
		t.Fatal(err)
	}
	if err := store.recoverSubmissions(ctx); err != nil || adds.Load() != 1 {
		t.Fatalf("expired recovery adds=%d err=%v", adds.Load(), err)
	}
	var state string
	if err := db.QueryRow(`SELECT fulfillment_state FROM acquisition_requests WHERE id='request'`).Scan(&state); err != nil || state != "downloading" {
		t.Fatalf("state=%q err=%v", state, err)
	}
}

func TestQBitTorrentKeepsPortScopedSessionCookie(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "QBT_SID_8080", Value: "session"})
			w.WriteHeader(http.StatusNoContent)
		case "/api/v2/torrents/add":
			if cookie, _ := r.Cookie("QBT_SID_8080"); cookie == nil || cookie.Value != "session" {
				http.Error(w, "missing session", http.StatusForbidden)
				return
			}
			_, _ = w.Write([]byte("Ok."))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, _ := New(Options{QBitURL: server.URL})
	if _, err := client.addTracked(context.Background(), "magnet:?xt=urn:btih:abcdef", ""); err != nil {
		t.Fatal(err)
	}
}

func TestRejectsUnsafeConfigurationAndDownload(t *testing.T) {
	if _, err := New(Options{IndexerURL: "file:///etc/passwd"}); err == nil {
		t.Fatal("accepted unsafe indexer URL")
	}
	if _, err := New(Options{IndexerURL: "https://user:password@indexer.test"}); err == nil {
		t.Fatal("accepted credentials embedded in connector URL")
	}
	client, _ := New(Options{QBitURL: "https://qbit.test"})
	for _, unsafe := range []string{"file:///tmp/book", "https://user:pass@example.test/book", "magnet:?dn=missing-hash"} {
		if _, err := client.addTracked(context.Background(), unsafe, ""); err == nil || !strings.Contains(err.Error(), "invalid") {
			t.Fatalf("url=%q err=%v", unsafe, err)
		}
	}
	if _, err := client.addTracked(context.Background(), "magnet:?xt=urn:btih:abcdef", "bad,tag"); err == nil {
		t.Fatal("accepted unsafe tracking tag")
	}
}

func TestIndexerRefusesCrossOriginRedirect(t *testing.T) {
	reached := false
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer redirect.Close()
	client, _ := New(Options{IndexerURL: redirect.URL})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := client.Search(ctx, "alice"); err == nil || reached {
		t.Fatalf("err=%v reached=%v", err, reached)
	}
}
