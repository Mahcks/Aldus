package catalog

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMetadataRefreshDoesNotRequireArtwork(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/search":
			w.Write([]byte(`{"docs":[{"key":"/works/OL1W","title":"A Book","author_name":["An Author"]}]}`))
		case "/work":
			w.Write([]byte(`{"description":"The complete synopsis."}`))
		case "/editions":
			w.Write([]byte(`{"entries":[]}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer upstream.Close()
	ctx := context.Background()
	metadata, err := refreshOpenLibraryMetadata(ctx, upstream.Client(), upstream.URL+"/search", "A Book", "An Author", func(string) string { return upstream.URL + "/work" }, func(string) string { return upstream.URL + "/editions" })
	if err != nil || metadata.Description != "The complete synopsis." || metadata.CoverID != "" {
		t.Fatalf("metadata=%+v err=%v", metadata, err)
	}
	store, _, admin := testCatalog(t)
	library, err := store.CreateLibrary(ctx, admin, "Books")
	if err != nil {
		t.Fatal(err)
	}
	work, err := store.CreateWork(ctx, admin, library.ID, "A Book", "An Author")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.saveRefreshedMetadata(ctx, work.ID, metadata); err != nil {
		t.Fatal(err)
	}
	detail, err := store.WorkDetail(ctx, admin, work.ID)
	if err != nil || detail.Description != metadata.Description || detail.CoverURL != "" {
		t.Fatalf("detail=%+v err=%v", detail, err)
	}
	var count int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM work_covers WHERE work_id=?`, work.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("created empty cover")
	}
}
