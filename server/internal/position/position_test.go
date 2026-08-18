package position

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
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

func TestKOReaderContainerStartResolvesToFirstFragmentSegment(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	raw := MarshalKOReaderParagraph(EPUBParagraph{
		KOReaderFragment: 4,
		KOReaderNodes: []KOReaderTextNode{{
			Path: "html[1]/body[1]/div[1]/p[1]/text()[1]",
			Text: "Chapter opening paragraph.",
		}},
	})
	next := MarshalKOReaderParagraph(EPUBParagraph{
		KOReaderFragment: 4,
		KOReaderNodes: []KOReaderTextNode{{
			Path: "html[1]/body[1]/div[1]/p[2]/text()[1]",
			Text: "First synchronized paragraph.",
		}},
	})
	if _, err := store.db.ExecContext(ctx, `UPDATE alignment_segments SET koreader_locator=?, highlightable=0 WHERE alignment_id=? AND id='s0001'`, raw, FixtureAlignmentID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE alignment_segments SET koreader_locator=? WHERE alignment_id=? AND id='s0002'`, next, FixtureAlignmentID); err != nil {
		t.Fatal(err)
	}
	got, err := store.KOReaderToCanonical(ctx, KOReaderLocator{
		DocumentID: "fixture-koreader-document",
		Progress:   "/body/DocFragment[4]/body/div.0",
	})
	if err != nil || got.SegmentID != "s0002" || got.Offset != 0 {
		t.Fatalf("container start = %#v, %v", got, err)
	}
}

func TestWordAwareOffsets(t *testing.T) {
	words := `[{"text":"Alice","startTime":10.0,"endTime":10.4},{"text":"opened","startTime":10.6,"endTime":11.0},{"text":"the","startTime":11.1,"endTime":11.3},{"text":"door","startTime":11.4,"endTime":11.8}]`
	text := "Alice opened the door"
	if timestamp, ok := wordTimestamp(500_000, text, words); !ok || timestamp != 10_600 {
		t.Fatalf("middle text position = %d, %v", timestamp, ok)
	}
	if offset, ok := wordOffset(11_200, text, words); !ok || offset != 619_047 {
		t.Fatalf("audio word position = %d, %v", offset, ok)
	}
	if _, ok := wordTimestamp(500_000, text, `[{"text":"","startTime":0}]`); ok {
		t.Fatal("malformed timing did not fail closed")
	}
	punctuated := "Alice said, ‘cut your finger very deeply.’"
	punctuatedWords := `[{"text":"Alice","startTime":1,"endTime":1.1},{"text":"said","startTime":2,"endTime":2.1},{"text":"cut","startTime":3,"endTime":3.1},{"text":"your","startTime":4,"endTime":4.1},{"text":"finger","startTime":5,"endTime":5.1},{"text":"deeply","startTime":6,"endTime":6.1}]`
	fingerOffset := len([]rune("Alice said, ‘cut your ")) * OffsetMax / len([]rune(punctuated))
	if timestamp, ok := wordTimestamp(fingerOffset, punctuated, punctuatedWords); !ok || timestamp != 5_000 {
		t.Fatalf("punctuated text position = %d, %v", timestamp, ok)
	}
	if offset, ok := wordOffset(5_050, punctuated, punctuatedWords); !ok || offset != fingerOffset {
		t.Fatalf("punctuated audio position = %d, %v", offset, ok)
	}
}

func TestProgressRejectsStaleUpdate(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	userID := addFixtureUser(t, store)
	first, err := store.UpdateProgress(ctx, userID, "fixture-work", FixtureAlignmentID, Update{
		SegmentID: "s0001", ExpectedRevision: 0, SourceDevice: "device-a",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.UpdateProgress(ctx, userID, "fixture-work", FixtureAlignmentID, Update{
		SegmentID: "s0003", ExpectedRevision: first.Revision, SourceDevice: "device-b",
	})
	if err != nil {
		t.Fatal(err)
	}
	current, err := store.UpdateProgress(ctx, userID, "fixture-work", FixtureAlignmentID, Update{
		SegmentID: "s0001", ExpectedRevision: first.Revision, SourceDevice: "device-a",
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("stale update error = %v", err)
	}
	if current.SegmentID != second.SegmentID || current.Revision != second.Revision {
		t.Fatalf("conflict current = %#v, want %#v", current, second)
	}
}

func TestProgressPromotesWantToReadButPreservesFinished(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	userID := addFixtureUser(t, store)
	if _, err := store.db.Exec(`INSERT INTO user_work_statuses(user_id,work_id,status,updated_at) VALUES(?,?,'want_to_read','now')`, userID, "fixture-work"); err != nil {
		t.Fatal(err)
	}
	written, err := store.UpdateProgress(ctx, userID, "fixture-work", FixtureAlignmentID, Update{SegmentID: "s0001", ExpectedRevision: 0, SourceDevice: "web"})
	if err != nil {
		t.Fatal(err)
	}
	var status string
	if err := store.db.QueryRow(`SELECT status FROM user_work_statuses WHERE user_id=? AND work_id=?`, userID, "fixture-work").Scan(&status); err != nil || status != "reading" {
		t.Fatalf("promoted status = %q, %v", status, err)
	}
	if _, err := store.db.Exec(`UPDATE user_work_statuses SET status='finished' WHERE user_id=? AND work_id=?`, userID, "fixture-work"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateProgress(ctx, userID, "fixture-work", FixtureAlignmentID, Update{SegmentID: "s0002", ExpectedRevision: written.Revision, SourceDevice: "web"}); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT status FROM user_work_statuses WHERE user_id=? AND work_id=?`, userID, "fixture-work").Scan(&status); err != nil || status != "finished" {
		t.Fatalf("preserved status = %q, %v", status, err)
	}
}

func TestReadingStateIsPerUserAndPreservesStaleCanonicalPosition(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	firstUser := addFixtureUser(t, store)
	secondUser := addFixtureUserNamed(t, store, "other-user", "other")

	written, err := store.UpdateProgress(ctx, firstUser, "fixture-work", FixtureAlignmentID, Update{
		SegmentID: "s0002", Offset: 123_456, ExpectedRevision: 0, SourceDevice: "web",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Progress(ctx, secondUser, "fixture-work"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user's progress error = %v", err)
	}
	if _, err := store.db.Exec(`UPDATE alignments SET state='stale' WHERE id=?`, FixtureAlignmentID); err != nil {
		t.Fatal(err)
	}
	stale, err := store.Progress(ctx, firstUser, "fixture-work")
	if err != nil {
		t.Fatal(err)
	}
	if stale.SegmentID != written.SegmentID || stale.Offset != written.Offset || stale.AlignmentState != "stale" || stale.Resolvable == nil || *stale.Resolvable {
		t.Fatalf("stale progress = %#v", stale)
	}
	if _, err := store.UpdateProgress(ctx, firstUser, "fixture-work", FixtureAlignmentID, Update{SegmentID: "s0003", ExpectedRevision: written.Revision, SourceDevice: "web"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("update through stale alignment error = %v", err)
	}
	if _, err := store.db.Exec(`UPDATE alignments SET state='ready' WHERE id=?`, FixtureAlignmentID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`UPDATE alignment_segments SET highlightable=0 WHERE alignment_id=? AND id=?`, FixtureAlignmentID, written.SegmentID); err != nil {
		t.Fatal(err)
	}
	partial, err := store.Progress(ctx, firstUser, "fixture-work")
	if err != nil {
		t.Fatal(err)
	}
	if partial.AlignmentState != "ready" || partial.Resolvable == nil || *partial.Resolvable {
		t.Fatalf("unhighlightable progress = %#v", partial)
	}
}

func TestRepresentationStateIsIndependentAndOptimistic(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	userID := addFixtureUser(t, store)
	audioMS, speed := int64(33295), 1.25
	state, err := store.UpdateRepresentationState(ctx, userID, "fixture-audio-representation", RepresentationUpdate{
		AudioTimestampMS: &audioMS, PlaybackSpeed: &speed, ExpectedRevision: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	if state.Revision != 1 || state.AudioTimestampMS == nil || *state.AudioTimestampMS != audioMS || state.PlaybackSpeed == nil || *state.PlaybackSpeed != speed {
		t.Fatalf("audio state = %#v", state)
	}
	current, err := store.UpdateRepresentationState(ctx, userID, "fixture-audio-representation", RepresentationUpdate{
		AudioTimestampMS: &audioMS, ExpectedRevision: 0,
	})
	if !errors.Is(err, ErrConflict) || current.Revision != state.Revision {
		t.Fatalf("conflict = %#v, %v", current, err)
	}
	if _, err := store.Progress(ctx, userID, "fixture-work"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("native state invented canonical progress: %v", err)
	}
	if _, err := store.RepresentationState(ctx, addFixtureUserNamed(t, store, "isolated-user", "isolated"), "fixture-audio-representation"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user's representation state error = %v", err)
	}
}

func TestNativeStateSurvivesUnresolvedPositionAndDatabaseReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "aldus.db")
	store, err := openTestStore(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SeedFixture(ctx); err != nil {
		t.Fatal(err)
	}
	userID := addFixtureUser(t, store)
	if _, err := store.db.Exec(`UPDATE alignment_segments SET highlightable=0 WHERE alignment_id=? AND id='s0003'`, FixtureAlignmentID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateProgress(ctx, userID, "fixture-work", FixtureAlignmentID, Update{SegmentID: "s0003", ExpectedRevision: 0, SourceDevice: "web"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unresolved canonical update error = %v", err)
	}
	locator := json.RawMessage(`{"href":"text/chapter-1.xhtml","locations":{"cfi":"epubcfi(/6/2!/4/2:3)"}}`)
	zoom, lineHeight, margin := 1.2, 1.8, 2.0
	if _, err := store.UpdateRepresentationState(ctx, userID, "fixture-epub-representation", RepresentationUpdate{EPUBLocator: locator, ReaderLayout: "paginated", Zoom: &zoom, ReaderTheme: "sepia", LineHeight: &lineHeight, Margin: &margin, ExpectedRevision: 0}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = openTestStore(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	state, err := store.RepresentationState(ctx, userID, "fixture-epub-representation")
	if err != nil {
		t.Fatal(err)
	}
	if string(state.EPUBLocator) != string(locator) || state.ReaderLayout != "paginated" || state.ReaderTheme != "sepia" || state.Zoom == nil || *state.Zoom != zoom || state.LineHeight == nil || *state.LineHeight != lineHeight || state.Margin == nil || *state.Margin != margin {
		t.Fatalf("reopened EPUB state = %#v", state)
	}
	updatedMargin := 1.0
	state, err = store.UpdateRepresentationState(ctx, userID, "fixture-epub-representation", RepresentationUpdate{Margin: &updatedMargin, ExpectedRevision: state.Revision})
	if err != nil || string(state.EPUBLocator) != string(locator) || state.ReaderTheme != "sepia" || state.Margin == nil || *state.Margin != updatedMargin {
		t.Fatalf("partial preference update = %#v, %v", state, err)
	}
}

func TestConcurrentProgressUpdateAllowsOneRevision(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	userID := addFixtureUser(t, store)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, segment := range []string{"s0001", "s0002"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := store.UpdateProgress(ctx, userID, "fixture-work", FixtureAlignmentID, Update{SegmentID: segment, ExpectedRevision: 0, SourceDevice: "device"})
			results <- err
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	var successes, conflicts int
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrConflict):
			conflicts++
		default:
			t.Fatalf("concurrent update error = %v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes=%d conflicts=%d", successes, conflicts)
	}
}

func addFixtureUser(t *testing.T, store *Store) string {
	t.Helper()
	return addFixtureUserNamed(t, store, "fixture-user", "reader")
}

func addFixtureUserNamed(t *testing.T, store *Store, userID, username string) string {
	t.Helper()
	if _, err := store.db.Exec(`INSERT OR IGNORE INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES(?,?,?,?,?,0,0,?,?); INSERT OR IGNORE INTO library_members(library_id,user_id,role,created_at) VALUES('fixture-library',?,'reader',?)`, userID, username, username, username, "test-only", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", userID, "2026-01-01T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	return userID
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
