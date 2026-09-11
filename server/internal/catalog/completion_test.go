package catalog

import (
	"context"
	"strings"
	"testing"
)

func TestLocatorCompletion(t *testing.T) {
	for _, test := range []struct {
		locator string
		percent int
		known   bool
	}{
		{`{"totalProgression":0.42}`, 42, true},
		{`{"locations":{"totalProgression":0}}`, 0, true},
		{`{"locations":{"totalProgression":1}}`, 100, true},
		{`{"locations":{"progression":0.9}}`, 0, false},
		{`{"totalProgression":2}`, 0, false},
		{`{"totalProgression":"0.5"}`, 0, false},
		{`{"cfi":"epubcfi(/6/2)"}`, 0, false},
	} {
		percent, known := locatorCompletion([]byte(test.locator))
		if percent != test.percent || known != test.known {
			t.Errorf("%s: got %d/%v, want %d/%v", test.locator, percent, known, test.percent, test.known)
		}
	}
}

func TestStandaloneAudioCompletion(t *testing.T) {
	ctx := context.Background()
	store, accounts, admin := testCatalog(t)
	library, err := store.CreateLibrary(ctx, admin, "Audio")
	if err != nil {
		t.Fatal(err)
	}
	work, err := store.CreateWork(ctx, admin, library.ID, "A book", "Author")
	if err != nil {
		t.Fatal(err)
	}
	representation, err := store.CreateRepresentation(ctx, admin, work.ID, "audiobook", "Narration")
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.db.ExecContext(ctx, `
 INSERT INTO media (id, representation_id, kind, path, sha256, created_at, duration_ms)
 VALUES ('audio-completion', ?, 'audio', '/unused', ?, '2026-01-01T00:00:00Z', 10000)
 `, representation.ID, strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.db.ExecContext(ctx, `
 INSERT INTO representation_state (user_id, representation_id, audio_timestamp_ms, revision, updated_at)
 VALUES (?, ?, 2500, 1, '2026-01-01T00:00:00Z')
 `, admin.ID, representation.ID)
	if err != nil {
		t.Fatal(err)
	}
	detail, err := store.WorkDetail(ctx, admin, work.ID)
	if err != nil || detail.CompletionPercent != 25 {
		t.Fatalf("detail completion = %d, %v", detail.CompletionPercent, err)
	}
	works, _, err := store.BrowseWorks(ctx, admin, BrowseOptions{Availability: "in_progress"})
	if err != nil || len(works) != 1 || works[0].CompletionPercent != 25 {
		t.Fatalf("browse = %#v, %v", works, err)
	}
	outsider := createUser(t, accounts, admin, "audio-outsider")
	completion, err := store.editionCompletion(ctx, outsider, []string{work.ID})
	if err != nil || len(completion) != 0 {
		t.Fatalf("outsider completion = %#v, %v", completion, err)
	}
}
