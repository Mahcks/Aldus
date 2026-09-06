package acquisition

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestOpenLibraryTrendingFromParsesWorksAndSkipsBlankTitles(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			t.Error("missing User-Agent")
		}
		_, _ = w.Write([]byte(`{"query":"/trending/weekly","works":[{"key":"/works/OL17930368W","title":"Atomic Habits","author_name":["James Clear"],"cover_i":12539702},{"key":"/works/OL2W","title":"  "}]}`))
	}))
	defer server.Close()

	got, err := openLibraryTrendingFrom(context.Background(), server.Client(), server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d items, want 1 (blank title skipped): %+v", len(got), got)
	}
	item := got[0]
	if item.Title != "Atomic Habits" || item.Author != "James Clear" || item.ExternalSource != "open_library" || item.ExternalID != "OL17930368W" || item.CoverURL == "" {
		t.Fatalf("item = %+v", item)
	}

	server.Close()
	if _, err := openLibraryTrendingFrom(context.Background(), server.Client(), server.URL); err == nil {
		t.Fatal("remote failure was not reported")
	}
}

func TestNYTBestsellersFromParsesModernAndLegacyShapes(t *testing.T) {
	modern := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"OK","results":{"list_name":"Hardcover Fiction","books":[{"rank":1,"title":"THE ROAD","author":"Cormac McCarthy","book_image":"https://example.com/road.jpg"},{"rank":2,"title":"  "}]}}`))
	}))
	defer modern.Close()
	got, err := nytBestsellersFrom(context.Background(), modern.Client(), modern.URL)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Title != "The Road" || got[0].Author != "Cormac McCarthy" || got[0].CoverURL == "" {
		t.Fatalf("modern-shape items = %+v", got)
	}

	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"OK","results":[{"list_name":"Trade Fiction Paperback","book_details":[{"title":"WOLF HALL","author":"Hilary Mantel"}]}]}`))
	}))
	defer legacy.Close()
	got, err = nytBestsellersFrom(context.Background(), legacy.Client(), legacy.URL)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Title != "Wolf Hall" || got[0].Author != "Hilary Mantel" {
		t.Fatalf("legacy-shape items = %+v", got)
	}

	failing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer failing.Close()
	if _, err := nytBestsellersFrom(context.Background(), failing.Client(), failing.URL); err == nil {
		t.Fatal("an invalid API key was not reported")
	}
}

func TestTitleCaseNormalizesShoutingTitles(t *testing.T) {
	if got := titleCase("THE GIRL WITH THE DRAGON TATTOO"); got != "The Girl With The Dragon Tattoo" {
		t.Fatalf("titleCase = %q", got)
	}
}

func TestMatchTrendingItemsAnnotatesOwnedAndRequestedTitles(t *testing.T) {
	catalogIndex := map[string]TitleSearchResult{
		exactTitleKey("Atomic Habits", "James Clear"): {WorkID: "local-work", Title: "Atomic Habits", Author: "James Clear", Readable: true},
	}
	requests := []titleRequestProjection{
		{Title: "Dune", Author: "Frank Herbert", Format: "ebook", State: "wanted"},
	}
	items := []trendingItem{
		{Title: "Atomic Habits", Author: "James Clear", ExternalSource: "open_library", ExternalID: "OL1W"},
		{Title: "Dune", Author: "Frank Herbert", ExternalSource: "open_library", ExternalID: "OL2W"},
		{Title: "Project Hail Mary", Author: "Andy Weir", ExternalSource: "open_library", ExternalID: "OL3W"},
	}

	results := matchTrendingItems(items, catalogIndex, requests)
	if len(results) != 3 {
		t.Fatalf("results = %#v", results)
	}
	if results[0].WorkID != "local-work" || !results[0].Readable {
		t.Fatalf("owned title not merged with local catalog: %+v", results[0])
	}
	if results[1].WorkID != "" || results[1].EbookRequestState != "wanted" {
		t.Fatalf("requested-but-unowned title missing request state: %+v", results[1])
	}
	if results[2].WorkID != "" || results[2].ExternalID != "OL3W" || results[2].EbookRequestState != "" {
		t.Fatalf("unmatched title should pass through untouched: %+v", results[2])
	}
}

func TestTrendingCatalogIndexKeysByExactTitle(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('reader','reader','reader','Reader','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('visible','Visible','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('visible','reader','owner','2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if _, err := catalog.New(db).CreateWork(ctx, auth.User{ID: "reader"}, "visible", "Atomic Habits", "James Clear"); err != nil {
		t.Fatal(err)
	}

	for i := 0; i < 105; i++ {
		if _, err := catalog.New(db).CreateWork(ctx, auth.User{ID: "reader"}, "visible", fmt.Sprintf("Book %03d", i), "Author"); err != nil {
			t.Fatal(err)
		}
	}
	store := NewStore(db, nil)
	index, err := store.trendingCatalogIndex(ctx, auth.User{ID: "reader"}, "")
	if err != nil {
		t.Fatal(err)
	}
	result, ok := index[exactTitleKey("Atomic Habits", "James Clear")]
	if len(index) != 106 {
		t.Fatalf("expected all 106 books, got %d", len(index))
	}
	if !ok || result.WorkID == "" {
		t.Fatalf("index = %#v", index)
	}
}

func TestTrendingFailureCachesAndCredentialRotation(t *testing.T) {
	calls := 0
	client := &Client{http: &http.Client{Transport: metadataRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: http.StatusForbidden, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
	})}}
	store := NewStore(nil, client)
	for i := 0; i < 2; i++ {
		if _, err := store.Detail(context.Background(), "open_library", "OL1W"); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("cached failure became success: %v", err)
		}
	}
	if calls != 1 {
		t.Fatalf("description failure was not cached: %d", calls)
	}
	store.nytBestsellers(context.Background(), "old-key", "fiction")
	store.nytBestsellers(context.Background(), "old-key", "fiction")
	store.nytBestsellers(context.Background(), "new-key", "fiction")
	if calls != 3 {
		t.Fatalf("new credential did not bypass old failure: %d", calls)
	}
}

func TestNYTTransportErrorsDoNotExposeCredentials(t *testing.T) {
	client := &http.Client{Transport: metadataRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		return nil, errors.New("connection refused")
	})}
	_, err := nytBestsellersFrom(context.Background(), client, "https://example.com/books?api-key=secret-key")
	if err == nil || strings.Contains(err.Error(), "secret-key") {
		t.Fatalf("unsafe transport error: %v", err)
	}
}
