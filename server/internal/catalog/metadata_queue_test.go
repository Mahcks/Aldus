package catalog

import (
	"context"
	"slices"
	"strings"
	"testing"
)

func TestMetadataQueueFiltersBeforePaginationAndKeepsRecordingGaps(t *testing.T) {
	ctx := context.Background()
	store, accounts, admin := testCatalog(t)
	reader := createUser(t, accounts, admin, "metadata-reader")
	library, err := store.CreateLibrary(ctx, admin, "Metadata")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetMember(ctx, admin, library.ID, reader.ID, "reader"); err != nil {
		t.Fatal(err)
	}
	ebook, _ := store.CreateWork(ctx, admin, library.ID, "A book", "Writer")
	audio, _ := store.CreateWork(ctx, admin, library.ID, "B book", "Writer")
	other, _ := store.CreateWork(ctx, admin, library.ID, "C book", "Writer")
	_, _ = store.CreateRepresentation(ctx, admin, ebook.ID, "epub", "Ebook")
	credited, _ := store.CreateRepresentation(ctx, admin, audio.ID, "audio", "First recording")
	uncredited, _ := store.CreateRepresentation(ctx, admin, audio.ID, "audio", "Other recording")
	otherAudio, _ := store.CreateRepresentation(ctx, admin, other.ID, "audio", "Audio")
	if _, err := store.db.ExecContext(ctx, `INSERT INTO representation_narrators(representation_id,ordinal,name,name_key) VALUES(?,0,'Reader One','reader one')`, credited.ID); err != nil {
		t.Fatal(err)
	}
	// An empty audio edition must not turn an ebook into a missing-narrator task.
	_, _ = store.CreateRepresentation(ctx, admin, ebook.ID, "audio", "Empty audio edition")
	for _, recording := range []Representation{credited, uncredited, otherAudio} {
		if _, err := store.db.ExecContext(ctx, `
            INSERT INTO media(id, representation_id, kind, path, sha256, created_at)
            VALUES (?, ?, 'audio', 'recording.m4b', ?, '2026-01-01')`,
			recording.ID, recording.ID, strings.Repeat("a", 64)); err != nil {
			t.Fatal(err)
		}
	}
	books, more, err := store.BrowseWorks(ctx, reader, BrowseOptions{LibraryID: library.ID, MetadataMissing: "narrator", Sort: "title", Limit: 1})
	if err != nil || !more || len(books) != 1 || books[0].ID != audio.ID || !slices.Contains(books[0].MissingMetadata, "narrator") || !slices.Equal(books[0].Narrators, []string{"Reader One"}) {
		t.Fatalf("first filtered page: %#v more=%v err=%v", books, more, err)
	}
	books, more, err = store.BrowseWorks(ctx, reader, BrowseOptions{LibraryID: library.ID, MetadataMissing: "narrator", Sort: "title", Limit: 1, Offset: 1})
	if err != nil || more || len(books) != 1 || books[0].ID != other.ID {
		t.Fatalf("second page: %#v more=%v err=%v", books, more, err)
	}
	if _, _, err := store.BrowseWorks(ctx, reader, BrowseOptions{MetadataMissing: "bogus"}); err != ErrInvalid {
		t.Fatalf("invalid filter: %v", err)
	}
	outsider := createUser(t, accounts, admin, "metadata-outsider")
	books, _, err = store.BrowseWorks(ctx, outsider, BrowseOptions{LibraryID: library.ID, MetadataMissing: "any"})
	if err != nil || len(books) != 0 {
		t.Fatalf("private library leaked: %#v %v", books, err)
	}
	// A short, manually written description is present, not deficient.
	if _, err := store.db.ExecContext(ctx, `INSERT INTO work_metadata(work_id,description,updated_at) VALUES(?,'Short on purpose.','2026-01-01')`, ebook.ID); err != nil {
		t.Fatal(err)
	}
	books, _, err = store.BrowseWorks(ctx, reader, BrowseOptions{LibraryID: library.ID, MetadataMissing: "description"})
	if err != nil {
		t.Fatal(err)
	}
	for _, book := range books {
		if book.ID == ebook.ID {
			t.Fatal("short description was marked missing")
		}
	}
}

func TestMissingNarratorRequiresAvailableAudioInThatRecording(t *testing.T) {
	ctx := context.Background()
	store, _, admin := testCatalog(t)
	library, err := store.CreateLibrary(ctx, admin, "Recordings")
	if err != nil {
		t.Fatal(err)
	}
	work, err := store.CreateWork(ctx, admin, library.ID, "Mixed editions", "Author")
	if err != nil {
		t.Fatal(err)
	}
	audio, err := store.CreateRepresentation(ctx, admin, work.ID, "audio", "Audio")
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.db.ExecContext(ctx, `
        INSERT INTO media(id, representation_id, kind, path, sha256, created_at)
        VALUES ('metadata-audio', ?, 'audio', 'book.m4b', ?, '2026-01-01')`, audio.ID, strings.Repeat("b", 64))
	if err != nil {
		t.Fatal(err)
	}
	check := func(want bool) {
		t.Helper()
		books, _, err := store.BrowseWorks(ctx, admin, BrowseOptions{LibraryID: library.ID})
		if err != nil || len(books) != 1 {
			t.Fatalf("browse: %#v %v", books, err)
		}
		if got := slices.Contains(books[0].MissingMetadata, "narrator"); got != want {
			t.Fatalf("narrator missing=%v want=%v", got, want)
		}
		matches, _, err := store.BrowseWorks(ctx, admin, BrowseOptions{LibraryID: library.ID, MetadataMissing: "narrator"})
		if err != nil || (len(matches) > 0) != want {
			t.Fatalf("filter: %#v %v", matches, err)
		}
	}
	check(true)
	if _, err := store.db.ExecContext(ctx, `
        INSERT INTO library_sources(id, library_id, kind, name, root_path, created_at, updated_at)
        VALUES ('metadata-source', ?, 'local', 'Source', '/books', '2026-01-01', '2026-01-01');
        INSERT INTO source_entries(id, source_id, relative_path, size_bytes, modified_at, sha256, state, created_at, updated_at)
        VALUES ('metadata-entry', 'metadata-source', 'book.m4b', 100, '2026-01-01', (SELECT sha256 FROM media WHERE id='metadata-audio'), 'missing', '2026-01-01', '2026-01-01');
        UPDATE media SET storage_kind='referenced', source_entry_id='metadata-entry' WHERE id='metadata-audio';
        INSERT INTO media_locations(media_id, source_entry_id, created_at)
        VALUES ('metadata-audio', 'metadata-entry', '2026-01-01')`, library.ID); err != nil {
		t.Fatal(err)
	}
	check(false) // No registered, enabled source location is available.
	if _, err := store.db.ExecContext(ctx, `UPDATE source_entries SET state='registered' WHERE id='metadata-entry'`); err != nil {
		t.Fatal(err)
	}
	check(true)
	if _, err := store.db.ExecContext(ctx, `UPDATE library_sources SET enabled=0 WHERE id='metadata-source'`); err != nil {
		t.Fatal(err)
	}
	check(false)
	if _, err := store.db.ExecContext(ctx, `UPDATE media SET storage_kind='managed', source_entry_id=NULL, kind='epub' WHERE id='metadata-audio'`); err != nil {
		t.Fatal(err)
	}
	check(false) // A representation label alone cannot make an EPUB an audiobook.
}
