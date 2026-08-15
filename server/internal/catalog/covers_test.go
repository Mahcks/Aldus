package catalog

import (
	"bytes"
	"context"
	"encoding/base64"
	"strings"
	"testing"
)

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
