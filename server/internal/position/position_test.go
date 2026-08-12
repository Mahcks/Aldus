package position

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	store, err := openTestStore(context.Background(), filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.SeedFixture(context.Background()); err != nil {
		t.Fatal(err)
	}
	return store
}

func TestOpenRelativePath(t *testing.T) {
	directory := t.TempDir()
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(directory); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(workingDirectory) })
	store, err := openTestStore(context.Background(), "relative.db")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestResolverRoundTrips(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	want := Canonical{AlignmentID: FixtureAlignmentID, SegmentID: "s0002", Offset: 350_000}

	audio, err := store.CanonicalToAudio(ctx, want)
	if err != nil {
		t.Fatal(err)
	}
	got, err := store.AudioToCanonical(ctx, FixtureAlignmentID, audio)
	if err != nil {
		t.Fatal(err)
	}
	if got.SegmentID != want.SegmentID || got.Offset != want.Offset {
		t.Fatalf("audio round trip = %#v, want %#v", got, want)
	}

	epub, err := store.CanonicalToEPUB(ctx, want)
	if err != nil {
		t.Fatal(err)
	}
	got, err = store.EPUBToCanonical(ctx, FixtureAlignmentID, epub)
	if err != nil {
		t.Fatal(err)
	}
	if got.SegmentID != want.SegmentID || got.Offset != want.Offset || !json.Valid(epub.Locator) {
		t.Fatalf("EPUB round trip = %#v, locator %s", got, epub.Locator)
	}

	koreader, err := store.CanonicalToKOReader(ctx, want)
	if err != nil {
		t.Fatal(err)
	}
	got, err = store.KOReaderToCanonical(ctx, koreader)
	if err != nil {
		t.Fatal(err)
	}
	if got.SegmentID != want.SegmentID {
		t.Fatalf("KOReader round trip = %#v, want segment %q", got, want.SegmentID)
	}
}

func TestProgressRejectsStaleUpdate(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	first, err := store.UpdateProgress(ctx, FixtureAlignmentID, Update{
		SegmentID: "s0001", ExpectedRevision: 0, SourceDevice: "device-a",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.UpdateProgress(ctx, FixtureAlignmentID, Update{
		SegmentID: "s0003", ExpectedRevision: first.Revision, SourceDevice: "device-b",
	})
	if err != nil {
		t.Fatal(err)
	}
	current, err := store.UpdateProgress(ctx, FixtureAlignmentID, Update{
		SegmentID: "s0001", ExpectedRevision: first.Revision, SourceDevice: "device-a",
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("stale update error = %v", err)
	}
	if current.SegmentID != second.SegmentID || current.Revision != second.Revision {
		t.Fatalf("conflict current = %#v, want %#v", current, second)
	}
}

func TestRemoveLegacyFixture(t *testing.T) {
	store := testStore(t)
	if err := store.RemoveLegacyFixture(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Alignment(context.Background(), FixtureAlignmentID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("legacy alignment remains: %v", err)
	}
}
