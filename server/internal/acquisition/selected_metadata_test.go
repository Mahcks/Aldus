package acquisition

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestSelectedDescriptionUpgradesSnippetAndPreservesFallback(t *testing.T) {
	for _, tc := range []struct {
		body   string
		status int
		want   string
	}{
		{`{"description":{"value":"Full synopsis."}}`, 200, "Full synopsis."},
		{`{"description":""}`, 200, "Opening sentence."},
		{`{}`, 503, "Opening sentence."},
	} {
		client := &Client{http: &http.Client{Transport: metadataRoundTripFunc(func(r *http.Request) (*http.Response, error) {
			if r.URL.Path != "/works/OL1W.json" {
				t.Fatalf("path: %s", r.URL.Path)
			}
			return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
		})}}
		store := &Store{client: client}
		selected := SearchResult{OpenLibraryID: "OL1W", Description: "Opening sentence."}
		store.enrichSelectedDescription(context.Background(), &selected)
		if selected.Description != tc.want {
			t.Fatalf("got %q want %q", selected.Description, tc.want)
		}
	}
}
