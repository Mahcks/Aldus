package catalog

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

func TestOpenLibraryGETRetriesTransientFailure(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		if requests == 1 {
			http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	response, err := openLibraryGET(context.Background(), server.Client(), server.URL)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if requests != 2 {
		t.Fatalf("requests = %d, want 2", requests)
	}
}

func TestOpenLibraryGETReportsUnavailableAfterRetry(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	response, err := openLibraryGET(context.Background(), server.Client(), server.URL)
	if response != nil || requests != 2 || !errors.Is(err, ErrMetadataUnavailable) {
		t.Fatalf("response = %#v, requests = %d, error = %v", response, requests, err)
	}
}

func TestParseOpenLibraryCovers(t *testing.T) {
	values, err := parseOpenLibraryCovers(strings.NewReader(`{"docs":[{"cover_i":42,"title":"Alice","author_name":["Lewis Carroll"],"publisher":["Macmillan"],"isbn":["123"],"first_publish_year":1865},{"cover_i":42,"title":"Duplicate"},{"title":"No cover"}]}`))
	if err != nil || len(values) != 1 {
		t.Fatalf("covers = %#v, %v", values, err)
	}
	got := values[0]
	if got.Source != "open_library" || got.SourceID != "42" || got.Title != "Alice" || got.Author != "Lewis Carroll" || got.Publisher != "Macmillan" || got.ISBN != "123" || got.FirstPublishYear != 1865 || got.ImageURL != "https://covers.openlibrary.org/b/id/42-L.jpg?default=false" {
		t.Fatalf("cover = %#v", got)
	}
}

func TestRefreshOpenLibraryMetadataUsesExactTitleAndAuthor(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/search" {
			_, _ = w.Write([]byte(`{"docs":[{"key":"/works/Wrong","cover_i":1,"title":"Astrophysics for People in a Hurry","author_name":["Someone Else"]},{"key":"/works/OL42W","cover_i":42,"title":"Astrophysics for People in a Hurry","author_name":["Neil deGrasse Tyson"]}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"description":{"value":"A short tour of the universe."}}`))
	}))
	defer server.Close()

	value, err := refreshOpenLibraryMetadata(context.Background(), server.Client(), server.URL+"/search", "Astrophysics for People in a Hurry", "Neil deGrasse Tyson", func(id string) string {
		return server.URL + "/works/" + id
	}, func(id string) string {
		return server.URL + "/works/" + id + "/editions"
	})
	if err != nil || value.CoverID != "42" || value.Description != "A short tour of the universe." {
		t.Fatalf("metadata = %#v, %v", value, err)
	}
}

func TestParseOpenLibraryCoversDropsNamespacedFacetKeys(t *testing.T) {
	values, err := parseOpenLibraryCovers(strings.NewReader(`{"docs":[{"cover_i":7,"title":"New Moon","subject":["series:Twilight","New York Times bestseller","nyt:series_books=2008-03-15","School & Education","Fiction","Vampires","Werewolves"]}]}`))
	if err != nil || len(values) != 1 {
		t.Fatalf("covers = %#v, %v", values, err)
	}
	want := []string{"New York Times bestseller", "School & Education", "Fiction", "Vampires", "Werewolves"}
	if got := values[0].Subjects; !slices.Equal(got, want) {
		t.Fatalf("subjects = %q, want %q", got, want)
	}
}

func TestCleanOpenLibrarySubjectsPreservesUsefulExactValues(t *testing.T) {
	input := []string{
		"series:Twilight", "Fiction", "Fantasy", "Mystery", "Romance", "Drama", "Poetry",
		"Civilization: history", "JUVENILE FICTION", "juvenile fiction", " time:Victorian ",
	}
	want := []string{"Fiction", "Fantasy", "Mystery", "Romance", "Drama", "Poetry", "Civilization: history", "JUVENILE FICTION"}
	if got := cleanOpenLibrarySubjects(input); !slices.Equal(got, want) {
		t.Fatalf("subjects = %q, want %q", got, want)
	}
}

func TestRefreshOpenLibraryMetadataPrefersNonForeignEdition(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/search":
			_, _ = w.Write([]byte(`{"docs":[{"key":"/works/OL27W","cover_i":27,"title":"Treasure Island","author_name":["Robert Louis Stevenson"],"publisher":["Destino"],"isbn":["9798657281057"],"language":["spa"],"first_publish_year":1883}]}`))
		case r.URL.Path == "/works/OL27W/editions":
			_, _ = w.Write([]byte(`{"entries":[{"publishers":["Destino"],"isbn_13":["9798657281057"],"languages":[{"key":"/languages/spa"}]},{"publishers":["Cassell & Company"],"isbn_13":["9780451530549"],"languages":[{"key":"/languages/eng"}]}]}`))
		default:
			_, _ = w.Write([]byte(`{"description":{"value":"A tale of pirates and treasure."}}`))
		}
	}))
	defer server.Close()

	value, err := refreshOpenLibraryMetadata(context.Background(), server.Client(), server.URL+"/search", "Treasure Island", "Robert Louis Stevenson", func(id string) string {
		return server.URL + "/works/" + id
	}, func(id string) string {
		return server.URL + "/works/" + id + "/editions"
	})
	if err != nil {
		t.Fatalf("refresh metadata: %v", err)
	}
	if value.Language != "eng" || value.Publisher != "Cassell & Company" || value.ISBN != "9780451530549" {
		t.Fatalf("metadata = %#v, want the English edition, not the Spanish search-doc default", value)
	}
}

func TestSaveRefreshedMetadataPreservesExistingValues(t *testing.T) {
	ctx := context.Background()
	store, _, admin := testCatalog(t)
	library, _ := store.CreateLibrary(ctx, admin, "Library")
	work, _ := store.CreateWork(ctx, admin, library.ID, "Astrophysics", "Neil deGrasse Tyson")
	if err := store.saveRefreshedMetadata(ctx, work.ID, refreshedMetadata{CoverID: "42", Description: "From Open Library"}); err != nil {
		t.Fatal(err)
	}
	detail, err := store.WorkDetail(ctx, admin, work.ID)
	if err != nil || detail.CoverURL == "" || detail.Description != "From Open Library" {
		t.Fatalf("first refresh = %#v, %v", detail, err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE work_metadata SET description='Curated'; UPDATE works SET selected_cover_id=NULL WHERE id=?`, work.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.SelectCover(ctx, admin, work.ID, "open_library", "99"); err != nil {
		t.Fatal(err)
	}
	if err := store.saveRefreshedMetadata(ctx, work.ID, refreshedMetadata{CoverID: "100", Description: "Replacement"}); err != nil {
		t.Fatal(err)
	}
	detail, err = store.WorkDetail(ctx, admin, work.ID)
	if err != nil || detail.CoverURL != openLibraryCoverURL("99") || detail.Description != "Curated" {
		t.Fatalf("preserved refresh = %#v, %v", detail, err)
	}
}

func TestSaveRefreshedMetadataPreservesSubjectBoundaries(t *testing.T) {
	ctx := context.Background()
	store, _, admin := testCatalog(t)
	library, _ := store.CreateLibrary(ctx, admin, "Library")
	work, _ := store.CreateWork(ctx, admin, library.ID, "Alice", "Lewis Carroll")
	subjects := []string{"Fiction, fantasy, general", "JUVENILE FICTION", "Classics"}
	if err := store.saveRefreshedMetadata(ctx, work.ID, refreshedMetadata{CoverID: "42", Subjects: subjects}); err != nil {
		t.Fatal(err)
	}
	detail, err := store.WorkDetail(ctx, admin, work.ID)
	if err != nil || !slices.Equal(detail.SubjectValues, subjects) {
		t.Fatalf("subjects = %q, %v", detail.SubjectValues, err)
	}
	if err := store.saveRefreshedMetadata(ctx, work.ID, refreshedMetadata{CoverID: "43", Subjects: []string{"Replacement"}}); err != nil {
		t.Fatal(err)
	}
	detail, err = store.WorkDetail(ctx, admin, work.ID)
	if err != nil || !slices.Equal(detail.SubjectValues, subjects) {
		t.Fatalf("subjects after second refresh = %q, %v", detail.SubjectValues, err)
	}
}

func TestUpdateWorkDetailsReplacesEditableMetadata(t *testing.T) {
	ctx := context.Background()
	store, _, admin := testCatalog(t)
	library, _ := store.CreateLibrary(ctx, admin, "Library")
	work, _ := store.CreateWork(ctx, admin, library.ID, "Old title", "Old author")
	update := WorkUpdate{
		Title: "Treasure Island", Author: "Robert Louis Stevenson",
		Description: "A sea adventure.", ISBN: "9780000000000", FirstPublishYear: 1883,
		Publisher: "Cassell & Company", Language: "English",
		Subjects: []string{"Adventure fiction", "Pirates", "adventure fiction"},
	}
	if err := store.UpdateWork(ctx, admin, work.ID, update); err != nil {
		t.Fatal(err)
	}
	detail, err := store.WorkDetail(ctx, admin, work.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Title != update.Title || detail.Author != update.Author || detail.Description != update.Description || detail.ISBN != update.ISBN || detail.FirstPublishYear != update.FirstPublishYear || detail.Publisher != update.Publisher || detail.Language != update.Language {
		t.Fatalf("detail = %#v", detail)
	}
	if want := []string{"Adventure fiction", "Pirates"}; !slices.Equal(detail.SubjectValues, want) {
		t.Fatalf("subjects = %q, want %q", detail.SubjectValues, want)
	}
}

func TestCoverStudioSettingsLibraryAndUploadDeletion(t *testing.T) {
	ctx := context.Background()
	store, _, admin := testCatalog(t)
	library, _ := store.CreateLibrary(ctx, admin, "Library")
	work, _ := store.CreateWork(ctx, admin, library.ID, "Alice", "Lewis Carroll")
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err := store.UploadCover(ctx, admin, work.ID, bytes.NewReader(png)); err != nil {
		t.Fatal(err)
	}
	assets, err := store.Covers(ctx, admin, work.ID)
	if err != nil || len(assets) != 1 || assets[0].Source != "upload" || !assets[0].Selected {
		t.Fatalf("assets = %#v, %v", assets, err)
	}
	if err := store.RestoreCover(ctx, admin, work.ID); err != nil {
		t.Fatal(err)
	}
	assets, err = store.Covers(ctx, admin, work.ID)
	if err != nil || len(assets) != 1 || assets[0].Selected {
		t.Fatalf("restored assets = %#v, %v", assets, err)
	}
	settings := CoverSettings{Fit: "contain", FocalX: 25, FocalY: 75, Style: "minimal", Tone: 3, Layout: "bottom"}
	if err := store.UpdateCoverSettings(ctx, admin, work.ID, settings); err != nil {
		t.Fatal(err)
	}
	updated, err := store.Work(ctx, admin, work.ID)
	if err != nil || updated.CoverFit != "contain" || updated.CoverFocalX != 25 || updated.CoverFocalY != 75 || updated.GeneratedCoverStyle != "minimal" || updated.GeneratedCoverTone != 3 || updated.GeneratedCoverLayout != "bottom" {
		t.Fatalf("settings = %#v, %v", updated, err)
	}
	if err := store.DeleteCover(ctx, admin, work.ID, assets[0].ID); err != nil {
		t.Fatal(err)
	}
	updated, _ = store.Work(ctx, admin, work.ID)
	if updated.CoverURL != "" {
		t.Fatalf("selected cover survived deletion: %q", updated.CoverURL)
	}
}
