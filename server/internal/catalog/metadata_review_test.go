package catalog

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type metadataTransport func(*http.Request) (*http.Response, error)

func (f metadataTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestMetadataCandidatesPreserveEditionsAndMissingCovers(t *testing.T) {
	client := &http.Client{Transport: metadataTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Scheme != "https" || r.URL.Host != "openlibrary.org" {
			t.Fatalf("unsafe URL: %s", r.URL)
		}
		body := ""
		switch r.URL.Path {
		case "/search.json":
			body = `
{
  "docs": [
    {
      "key": "/works/OL1W",
      "title": "Alice",
      "author_name": [
        "Lewis Carroll"
      ],
      "first_publish_year": 1865
    },
    {
      "key": "https://bad.test/x",
      "title": "Invalid"
    },
    {
      "key": "/works/OL2W",
      "title": "Alice",
      "author_name": [
        "Other Author"
      ]
    }
  ]
}
`
		case "/works/OL1W.json":
			body = `
{
  "title": "Alice",
  "first_publish_date": "1865",
  "description": {
    "value": "A story."
  },
  "authors": [
    {
      "author": {
        "key": "/authors/OL1A"
      }
    }
  ],
  "subjects": [
    "Fantasy"
  ]
}
`
		case "/authors/OL1A.json":
			body = `
{
  "name": "Lewis Carroll"
}
`
		case "/works/OL1W/editions.json":
			body = `
{
  "entries": [
    {
      "key": "/books/OL1M",
      "title": "Alice",
      "languages": [
        {
          "key": "/languages/eng"
        }
      ],
      "publishers": [
        "English Press"
      ],
      "isbn_13": [
        "9780000000001"
      ]
    },
    {
      "key": "/books/OL2M",
      "title": "Alicia",
      "languages": [
        {
          "key": "/languages/spa"
        }
      ],
      "publishers": [
        "Editorial Española"
      ],
      "isbn_13": [
        "9780000000002"
      ]
    },
    {
      "key": "/books/OL3M",
      "title": "Alicia",
      "languages": [
        {
          "key": "/languages/spa"
        }
      ]
    }
  ]
}
`
		default:
			t.Fatalf("unexpected request: %s", r.URL)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	values, err := searchMetadataCandidates(context.Background(), client, "Alice")
	if err != nil || len(values) != 2 || values[0].Values.CoverURL != "" || values[1].Values.Author != "Other Author" {
		t.Fatalf("search: %+v %v", values, err)
	}
	editions, err := metadataEditions(context.Background(), client, "OL1W", "spa", "9780000000002")
	if err != nil || len(editions) != 4 {
		t.Fatalf("editions: %+v %v", editions, err)
	}
	spanish := editions[0]
	if spanish.EditionID != "OL2M" || spanish.Values.Language != "spa" || spanish.Values.Publisher != "Editorial Española" || spanish.Values.ISBN != "9780000000002" || spanish.Values.Title != "Alicia" || spanish.Values.FirstPublishYear != 1865 {
		t.Fatalf("mixed edition: %+v", spanish)
	}
	if editions[1].EditionID != "OL3M" || editions[1].Values.ISBN != "" || editions[1].Values.Publisher != "" {
		t.Fatalf("borrowed missing fields: %+v", editions[1])
	}
}

func TestMetadataProviderFailureAndCancellation(t *testing.T) {
	for _, body := range []string{`not json`, `
{
  "docs": []
}
`} {
		client := &http.Client{Transport: metadataTransport(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
		})}
		values, err := searchMetadataCandidates(context.Background(), client, "Alice")
		if body == "not json" && !errors.Is(err, ErrMetadataUnavailable) {
			t.Fatalf("invalid response: %v", err)
		}
		if body != "not json" && (err != nil || len(values) != 0) {
			t.Fatalf("empty: %+v %v", values, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	client := &http.Client{Transport: metadataTransport(func(r *http.Request) (*http.Response, error) { return nil, r.Context().Err() })}
	if _, err := searchMetadataCandidates(ctx, client, "Alice"); err == nil {
		t.Fatal("cancellation ignored")
	}
}

func TestMetadataApplySelectedFieldsConflictAndAuthorization(t *testing.T) {
	ctx := context.Background()
	store, accounts, admin := testCatalog(t)
	library, _ := store.CreateLibrary(ctx, admin, "Books")
	work, _ := store.CreateWork(ctx, admin, library.ID, "Manual title", "Manual author")
	if err := store.UpdateWork(ctx, admin, work.ID, WorkUpdate{Title: work.Title, Author: work.Author, Description: "Keep this", Language: "eng", Publisher: "Old press", Subjects: []string{"Manual subject"}}); err != nil {
		t.Fatal(err)
	}
	// Older metadata may only have the comma-separated subject column.
	if _, err := store.db.ExecContext(ctx, "DELETE FROM work_subjects WHERE work_id=?", work.ID); err != nil {
		t.Fatal(err)
	}
	expected, err := store.MetadataCurrent(ctx, admin, work.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(expected.Subjects) != 1 || expected.Subjects[0] != "Manual subject" {
		t.Fatalf("legacy subjects lost: %+v", expected)
	}
	proposed := expected
	proposed.Title = "Provider title"
	proposed.Language = "spa"
	proposed.Description = ""
	proposed.Publisher = "New press"
	input := MetadataCorrection{WorkID: "OL1W", EditionID: "OL2M", Fields: []string{"language", "publisher"}, Expected: expected, Values: proposed}
	// A separate change to an unselected field must survive applying the preview.
	if err := store.UpdateWork(ctx, admin, work.ID, WorkUpdate{Title: "New manual title", Author: work.Author, Description: "Keep this", Language: "eng", Publisher: "Old press", Subjects: expected.Subjects}); err != nil {
		t.Fatal(err)
	}
	if err := store.ApplyMetadata(ctx, admin, work.ID, input); err != nil {
		t.Fatal(err)
	}
	current, _ := store.MetadataCurrent(ctx, admin, work.ID)
	if current.Title != "New manual title" || current.Description != "Keep this" || current.Language != "spa" || current.Publisher != "New press" || len(current.Subjects) != 1 {
		t.Fatalf("unselected fields changed: %+v", current)
	}
	var count int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM work_metadata_sources WHERE work_id=? AND provider_edition_id='OL2M'`, work.ID).Scan(&count); err != nil || count != 2 {
		t.Fatalf("provenance: %d %v", count, err)
	}
	if err := store.ApplyMetadata(ctx, admin, work.ID, input); !errors.Is(err, ErrMetadataConflict) {
		t.Fatalf("stale preview: %v", err)
	}
	input.Expected = current
	input.Fields = []string{"description"}
	if err := store.ApplyMetadata(ctx, admin, work.ID, input); err != nil {
		t.Fatal(err)
	}
	cleared, _ := store.MetadataCurrent(ctx, admin, work.ID)
	if cleared.Description != "" {
		t.Fatal("explicit clear ignored")
	}
	editor := createUser(t, accounts, admin, "editor")
	if err := store.SetMember(ctx, admin, library.ID, editor.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	input.Expected, err = store.MetadataCurrent(ctx, editor, work.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetMember(ctx, admin, library.ID, editor.ID, "reader"); err != nil {
		t.Fatal(err)
	}
	if err := store.ApplyMetadata(ctx, editor, work.ID, input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked editor applied: %v", err)
	}
	input.Fields = []string{"cover_url"}
	input.Values.CoverURL = "http://127.0.0.1/private"
	if err := store.ApplyMetadata(ctx, admin, work.ID, input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsafe cover: %v", err)
	}
	input.Values.CoverURL = openLibraryCoverURL("42")
	if err := store.ApplyMetadata(ctx, admin, work.ID, input); err != nil {
		t.Fatal(err)
	}
	input.Expected, err = store.MetadataCurrent(ctx, admin, work.ID)
	if err != nil || input.Expected.CoverURL != input.Values.CoverURL {
		t.Fatalf("cover was not selected: %+v %v", input.Expected, err)
	}
	input.Values.CoverURL = ""
	if err := store.ApplyMetadata(ctx, admin, work.ID, input); err != nil {
		t.Fatal(err)
	}
	input.Expected, err = store.MetadataCurrent(ctx, admin, work.ID)
	if err != nil || input.Expected.CoverURL != "" {
		t.Fatalf("cover was not cleared: %+v %v", input.Expected, err)
	}
	input.Fields = []string{"title"}
	input.Values.Title = ""
	if err := store.ApplyMetadata(ctx, admin, work.ID, input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty title: %v", err)
	}
}
