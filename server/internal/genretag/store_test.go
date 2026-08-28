package genretag

import (
	"context"
	"errors"
	"path/filepath"
	"slices"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestAdminWritesAndSubjectMatching(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	store := New(db)
	reader := auth.User{ID: "reader"}
	admin := auth.User{ID: "admin", Admin: true}

	if _, err := store.Create(ctx, reader, "Cozy", "happyFace", []string{"cozy"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("reader create = %v", err)
	}
	if _, err := store.Update(ctx, reader, "fantasy", "Fantasy", "sword", []string{"fantasy"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("reader update = %v", err)
	}
	if err := store.Delete(ctx, reader, "fantasy"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("reader delete = %v", err)
	}

	matched, err := store.Match(ctx, []string{"Epic FANTASY adventures", "Fantasy creatures", "Office manuals"})
	if err != nil {
		t.Fatal(err)
	}
	if len(matched) != 1 || matched[0].ID != "fantasy" || len(matched[0].Keywords) != 0 {
		t.Fatalf("matched = %#v", matched)
	}
	matched, err = store.Match(ctx, []string{"Treasure Island (Imaginary place)", "Pirates", "Treasure troves"})
	if err != nil || len(matched) != 1 || matched[0].ID != "adventure" {
		t.Fatalf("Treasure Island matched = %#v, %v", matched, err)
	}
	alice, err := store.Match(ctx, []string{"British and irish fiction (fictional works by one author)", "Fiction, fantasy, general", "JUVENILE FICTION", "classics", "Fantasy & Magic"})
	if err != nil || !slices.Equal(tagIDs(alice), []string{"children", "classic-literature", "fantasy"}) {
		t.Fatalf("Alice matched = %#v, %v", alice, err)
	}
	if containsPhrase("Award winners", "war") || containsPhrase("Display systems", "plays") {
		t.Fatal("phrase matching accepted a substring inside another word")
	}
	if !containsPhrase("Épopée historique", "E\u0301pope\u0301e") {
		t.Fatal("phrase matching did not normalize equivalent Unicode")
	}
	if containsPhrase("Historical novels", "historical novel") || containsPhrase("Pirates", "pirate") {
		t.Fatal("phrase matching invented a plural relationship")
	}

	created, err := store.Create(ctx, admin, "Cozy Mystery", "magnify", []string{" cozy mystery ", "COZY-MYSTERY"})
	if err != nil || len(created.Keywords) != 1 {
		t.Fatalf("created = %#v, %v", created, err)
	}
	if _, err := store.Create(ctx, admin, "Noise", "genres", []string{"---"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("punctuation-only keyword = %v", err)
	}
}

func TestUnmatchedSubjectsAreAdminOnlyAndCounted(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	store := New(db)
	if _, _, err := store.Unmatched(ctx, auth.User{}, 50, 0); !errors.Is(err, ErrForbidden) {
		t.Fatalf("reader unmatched = %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01','2026-01-01');
		INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES
			('one','library','One','2026-01-01','2026-01-01'),
			('two','library','Two','2026-01-01','2026-01-01'),
			('three','library','Three','2026-01-01','2026-01-01');
		INSERT INTO work_subjects(work_id,ordinal,subject) VALUES
			('one',0,'Naval fiction'),('two',0,'naval fiction'),('two',1,'Pirates'),
			('one',1,'Astronomy'),('three',0,'Domestic fiction');`); err != nil {
		t.Fatal(err)
	}
	admin := auth.User{Admin: true}
	first, more, err := store.Unmatched(ctx, admin, 1, 0)
	if err != nil || !more || len(first) != 1 || first[0].Subject != "Naval fiction" || first[0].WorkCount != 2 {
		t.Fatalf("first unmatched page = %#v, %v, %v", first, more, err)
	}
	second, more, err := store.Unmatched(ctx, admin, 1, 1)
	if err != nil || !more || len(second) != 1 || second[0].Subject != "Astronomy" {
		t.Fatalf("second unmatched page = %#v, %v, %v", second, more, err)
	}
	third, more, err := store.Unmatched(ctx, admin, 1, 2)
	if err != nil || more || len(third) != 1 || third[0].Subject != "Domestic fiction" {
		t.Fatalf("third unmatched page = %#v, %v, %v", third, more, err)
	}
}

func TestWorkGenresCanBeManuallyOverriddenAndReset(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.ExecContext(ctx, `
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('editor','editor','editor','Editor','x',0,0,'2026-01-01','2026-01-01');
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01','2026-01-01');
		INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('library','editor','editor','2026-01-01');
		INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('work','library','Work','2026-01-01','2026-01-01');`); err != nil {
		t.Fatal(err)
	}
	store := New(db)
	editor := auth.User{ID: "editor"}

	automatic, manual, err := store.ForWork(ctx, "work", []string{"Fantasy"})
	if err != nil || manual || !slices.Equal(tagIDs(automatic), []string{"fantasy"}) {
		t.Fatalf("automatic genres = %#v, manual=%v, err=%v", automatic, manual, err)
	}
	if err := store.SetWork(ctx, editor, "work", []string{"mystery", "adventure", "mystery"}); err != nil {
		t.Fatal(err)
	}
	selected, manual, err := store.ForWork(ctx, "work", []string{"Fantasy"})
	if err != nil || !manual || !slices.Equal(tagIDs(selected), []string{"adventure", "mystery"}) {
		t.Fatalf("manual genres = %#v, manual=%v, err=%v", selected, manual, err)
	}
	if err := store.SetWork(ctx, editor, "work", nil); err != nil {
		t.Fatal(err)
	}
	selected, manual, err = store.ForWork(ctx, "work", []string{"Fantasy"})
	if err != nil || !manual || len(selected) != 0 {
		t.Fatalf("empty manual genres = %#v, manual=%v, err=%v", selected, manual, err)
	}
	if err := store.ResetWork(ctx, editor, "work"); err != nil {
		t.Fatal(err)
	}
	selected, manual, err = store.ForWork(ctx, "work", []string{"Fantasy"})
	if err != nil || manual || !slices.Equal(tagIDs(selected), []string{"fantasy"}) {
		t.Fatalf("reset genres = %#v, manual=%v, err=%v", selected, manual, err)
	}
	if err := store.SetWork(ctx, auth.User{ID: "reader"}, "work", []string{"fantasy"}); !errors.Is(err, ErrWorkNotFound) {
		t.Fatalf("unauthorized work genres = %v", err)
	}
}

func tagIDs(tags []Tag) []string {
	ids := make([]string, len(tags))
	for i, tag := range tags {
		ids[i] = tag.ID
	}
	return ids
}
