package catalog

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAudiobookProviderBindingAndSummary(t *testing.T) {
	client := &http.Client{Transport: metadataTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "https://api.audnex.us/books/B123456789?region=us" {
			t.Fatalf("URL: %s", r.URL)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"asin":"B123456789","region":"us","title":"Recording","narrators":[{"name":"Narrator"}],"summary":"<p>Full &amp; complete.</p><script>bad()</script><p>Second paragraph.</p>"}`))}, nil
	})}
	value, err := fetchAudiobookMetadata(context.Background(), client, "B123456789", "us")
	if err != nil || value.Values.Description != "Full & complete.\n\nSecond paragraph." || len(value.Values.Narrators) != 1 {
		t.Fatalf("%+v %v", value, err)
	}
	if _, err := fetchAudiobookMetadata(context.Background(), client, "../bad", "us"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid ID: %v", err)
	}
	client.Transport = metadataTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"asin":"B987654321","region":"us","title":"Wrong recording"}`))}, nil
	})
	if _, err := fetchAudiobookMetadata(context.Background(), client, "B123456789", "us"); !errors.Is(err, ErrMetadataUnavailable) {
		t.Fatalf("mismatched recording: %v", err)
	}
	client.Transport = metadataTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 429, Body: io.NopCloser(strings.NewReader("limited"))}, nil
	})
	if _, err := fetchAudiobookMetadata(context.Background(), client, "B123456789", "us"); !errors.Is(err, ErrMetadataUnavailable) {
		t.Fatalf("provider failure: %v", err)
	}
}

func TestAudiobookMetadataSelectedAtomicAuthorized(t *testing.T) {
	ctx := context.Background()
	store, accounts, admin := testCatalog(t)
	library, _ := store.CreateLibrary(ctx, admin, "Books")
	work, _ := store.CreateWork(ctx, admin, library.ID, "Manual title", "Manual author")
	recording, _ := store.CreateRepresentation(ctx, admin, work.ID, "audio", "Recording")
	other, _ := store.CreateWork(ctx, admin, library.ID, "Other", "Other")
	input := AudiobookMetadataCorrection{ASIN: "B123456789", Region: "us", Fields: []string{"narrators"}, Expected: AudiobookMetadataValues{Narrators: []string{}}, Values: AudiobookMetadataValues{Narrators: []string{"New narrator"}, Description: "Full synopsis"}}
	stranger := createUser(t, accounts, admin, "stranger")
	if err := store.ApplyAudiobookMetadata(ctx, stranger, work.ID, recording.ID, input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("authorization: %v", err)
	}
	if err := store.ApplyAudiobookMetadata(ctx, admin, other.ID, recording.ID, input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross work: %v", err)
	}
	if err := store.ApplyAudiobookMetadata(ctx, admin, work.ID, recording.ID, input); err != nil {
		t.Fatal(err)
	}
	current, _ := store.MetadataCurrent(ctx, admin, work.ID)
	if current.Title != "Manual title" || current.Description != "" {
		t.Fatalf("unselected fields: %+v", current)
	}
	input.Fields = []string{"description", "narrators"}
	if err := store.ApplyAudiobookMetadata(ctx, admin, work.ID, recording.ID, input); !errors.Is(err, ErrMetadataConflict) {
		t.Fatalf("stale preview: %v", err)
	}
	current, _ = store.MetadataCurrent(ctx, admin, work.ID)
	if current.Description != "" {
		t.Fatal("conflicting transaction changed description")
	}
	input.Expected.Narrators = []string{"New narrator"}
	if err := store.ApplyAudiobookMetadata(ctx, admin, work.ID, recording.ID, input); err != nil {
		t.Fatal(err)
	}
	current, _ = store.MetadataCurrent(ctx, admin, work.ID)
	if current.Description != "Full synopsis" {
		t.Fatalf("description: %q", current.Description)
	}
	var count int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM representation_metadata_sources WHERE representation_id = ? AND asin = 'B123456789' AND region = 'us'`, recording.ID).Scan(&count); err != nil || count != 2 {
		t.Fatalf("provenance: %d %v", count, err)
	}
}

func TestAudiobookProviderBoundsAndRedirects(t *testing.T) {
	for _, mode := range []string{"oversized", "redirect", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "cancel" {
				cancel()
			}
			client := &http.Client{Transport: metadataTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				if mode == "cancel" {
					return nil, r.Context().Err()
				}
				if mode == "redirect" {
					return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"http://127.0.0.1/private"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(strings.Repeat(" ", (2<<20)+1)))}, nil
			})}
			if _, err := fetchAudiobookMetadata(ctx, client, "B123456789", "us"); !errors.Is(err, ErrMetadataUnavailable) {
				t.Fatalf("%s: %v", mode, err)
			}
			if calls > 1 {
				t.Fatalf("unsafe follow-up request: %d", calls)
			}
		})
	}
}
