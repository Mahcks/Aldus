package catalog

import (
	"context"
	"errors"
	"testing"
)

func TestFileMetadataRepairIsSelectedAuthorizedAndAtomic(t *testing.T) {
	ctx := context.Background()
	store, accounts, admin := testCatalog(t)
	outsider := createUser(t, accounts, admin, "metadata-outsider")
	library, err := store.CreateLibrary(ctx, admin, "Books")
	if err != nil {
		t.Fatal(err)
	}
	work, err := store.CreateWork(ctx, admin, library.ID, "A book", "Author")
	if err != nil {
		t.Fatal(err)
	}
	rep, err := store.CreateRepresentation(ctx, admin, work.ID, "audio", "Recording")
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.db.Exec(`INSERT INTO media(id,representation_id,kind,path,sha256,created_at) VALUES('file',?,'audio','immutable','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-01-01T00:00:00Z')`, rep.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`INSERT INTO representation_state(user_id,representation_id,audio_timestamp_ms,revision,updated_at) VALUES(?,?,12345,7,'2026-01-01T00:00:00Z')`, admin.ID, rep.ID); err != nil {
		t.Fatal(err)
	}
	before, err := store.FileMetadataCurrent(ctx, admin, "file")
	if err != nil {
		t.Fatal(err)
	}
	proposed := before
	proposed.Values.Description = "A complete synopsis."
	proposed.Narrators = []string{"Jane Doe", "John Smith"}
	proposed.Series = "A series"
	proposed.SeriesPosition = "2.5"
	request := FileMetadataCorrection{Fields: []string{"description", "narrators", "series"}, Expected: before, Values: proposed}
	if err := store.ApplyFileMetadata(ctx, outsider, "file", request); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unauthorized: %v", err)
	}
	if err := store.ApplyFileMetadata(ctx, admin, "file", request); err != nil {
		t.Fatal(err)
	}
	current, err := store.FileMetadataCurrent(ctx, admin, "file")
	if err != nil || current.Values.Description != proposed.Values.Description || len(current.Narrators) != 2 || current.SeriesPosition != "2.5" {
		t.Fatalf("repair: %+v %v", current, err)
	}
	request.Values.Values.Description = "Stale overwrite"
	if err := store.ApplyFileMetadata(ctx, admin, "file", request); !errors.Is(err, ErrMetadataConflict) {
		t.Fatalf("stale: %v", err)
	}
	request.Expected = current
	request.Values = current
	request.Values.Values.Description = "Must roll back"
	request.Values.SeriesPosition = "invalid"
	if err := store.ApplyFileMetadata(ctx, admin, "file", request); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid: %v", err)
	}
	after, err := store.FileMetadataCurrent(ctx, admin, "file")
	if err != nil || after.Values.Description != current.Values.Description {
		t.Fatalf("partial update: %+v %v", after, err)
	}
	var timestamp, revision int
	if err := store.db.QueryRow(`SELECT audio_timestamp_ms,revision FROM representation_state WHERE user_id=? AND representation_id=?`, admin.ID, rep.ID).Scan(&timestamp, &revision); err != nil {
		t.Fatal(err)
	}
	if timestamp != 12345 || revision != 7 {
		t.Fatal("repair changed reading state")
	}
	var path, hash, representationID string
	if err := store.db.QueryRow(`SELECT path,sha256,representation_id FROM media WHERE id='file'`).Scan(&path, &hash, &representationID); err != nil {
		t.Fatal(err)
	}
	if path != "immutable" || hash != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" || representationID != rep.ID {
		t.Fatal("metadata changed media identity")
	}
}
