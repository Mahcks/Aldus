package catalog

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"testing"
)

func TestFormatCoversRemainIndependent(t *testing.T) {
	ctx := context.Background()
	store, accounts, admin := testCatalog(t)
	library, err := store.CreateLibrary(ctx, admin, "Artwork")
	if err != nil {
		t.Fatal(err)
	}
	work, err := store.CreateWork(ctx, admin, library.ID, "Book", "Author")
	if err != nil {
		t.Fatal(err)
	}
	reader := createUser(t, accounts, admin, "art-reader")
	if err := store.SetMember(ctx, admin, library.ID, reader.ID, "reader"); err != nil {
		t.Fatal(err)
	}

	for i, format := range []string{"", "ebook", "audiobook"} {
		if err := store.SelectCover(ctx, admin, work.ID, format, "open_library", []string{"10", "20", "30"}[i]); err != nil {
			t.Fatal(err)
		}
	}
	assertCovers := func(ebook, audio string) {
		t.Helper()
		detail, err := store.Work(ctx, reader, work.ID)
		if err != nil {
			t.Fatal(err)
		}
		if detail.CoverURL != openLibraryCoverURL("10") || detail.EbookCoverURL != ebook || detail.AudiobookCoverURL != audio {
			t.Fatalf("unexpected artwork: library=%q ebook=%q audio=%q", detail.CoverURL, detail.EbookCoverURL, detail.AudiobookCoverURL)
		}
		listed, _, err := store.BrowseWorks(ctx, reader, BrowseOptions{})
		if err != nil || len(listed) != 1 || listed[0].EbookCoverURL != ebook || listed[0].AudiobookCoverURL != audio {
			t.Fatalf("browse artwork: %+v, %v", listed, err)
		}
	}
	assertCovers(openLibraryCoverURL("20"), openLibraryCoverURL("30"))

	if err := store.SelectCover(ctx, reader, work.ID, "audiobook", "open_library", "99"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reader changed artwork: %v", err)
	}
	if err := store.SelectCover(ctx, admin, work.ID, "invalid", "open_library", "99"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid format accepted: %v", err)
	}
	if err := store.RestoreCover(ctx, admin, work.ID, "audiobook"); err != nil {
		t.Fatal(err)
	}
	assertCovers(openLibraryCoverURL("20"), "")

	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UploadCover(ctx, admin, work.ID, "audiobook", bytes.NewReader(png)); err != nil {
		t.Fatal(err)
	}
	assets, err := store.Covers(ctx, admin, work.ID)
	if err != nil {
		t.Fatal(err)
	}
	var upload CoverAsset
	for _, asset := range assets {
		if asset.Source == "upload" {
			upload = asset
		}
	}
	if upload.ID == "" {
		t.Fatal("upload was not stored")
	}
	assertCovers(openLibraryCoverURL("20"), upload.ImageURL)

	other, err := store.CreateWork(ctx, admin, library.ID, "Other book", "Author")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SelectCover(ctx, admin, other.ID, "audiobook", "upload", upload.SourceID); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-work cover accepted: %v", err)
	}
	if err := store.DeleteWork(ctx, admin, other.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteCover(ctx, admin, work.ID, upload.ID); err != nil {
		t.Fatal(err)
	}
	assertCovers(openLibraryCoverURL("20"), "")
}
