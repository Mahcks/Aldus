package catalog

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAudiobookCoverSearchUsesEditionArtwork(t *testing.T) {
	store, _, admin := testCatalog(t)
	ctx := context.Background()
	library, err := store.CreateLibrary(ctx, admin, "Audio search")
	if err != nil {
		t.Fatal(err)
	}
	work, err := store.CreateWork(ctx, admin, library.ID, "Alice", "Lewis Carroll")
	if err != nil {
		t.Fatal(err)
	}
	previous := openLibraryHTTPClient
	t.Cleanup(func() { openLibraryHTTPClient = previous })
	openLibraryHTTPClient = &http.Client{Transport: metadataTransport(func(request *http.Request) (*http.Response, error) {
		if !strings.Contains(request.URL.Query().Get("q"), `format:"Audio CD"`) || !strings.Contains(request.URL.Query().Get("fields"), "editions.cover_i") {
			t.Fatalf("unfiltered search: %s", request.URL)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"docs":[{"cover_i":999,"author_name":["Lewis Carroll"],"editions":{"docs":[
   {"title":"Print edition", "format":["Paperback"], "cover_i":1},
   {"title":"Audio edition", "format":["Digital Audio"], "cover_i":2},
   {"title":"Audio without art", "format":["Audio CD"]},
   {"title":"Unknown format", "cover_i":3},
   {"title":"Duplicate", "format":["Audio Cassette"], "cover_i":2}
  ]}}]}`))}, nil
	})}
	candidates, err := store.SearchAudiobookCovers(ctx, admin, work.ID, "Alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 1 || candidates[0].SourceID != "2" || candidates[0].Title != "Audio edition" {
		t.Fatalf("candidates = %#v", candidates)
	}
}
