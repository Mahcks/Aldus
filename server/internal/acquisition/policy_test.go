package acquisition

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestPolicyDefaultsAuthorizationAndUpdate(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),('editor','editor','editor','Editor','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),('reader','reader','reader','Reader','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	admin := auth.User{ID: "admin", Admin: true}
	editor := auth.User{ID: "editor"}
	reader := auth.User{ID: "reader"}
	library, err := catalog.New(db).CreateLibrary(ctx, admin, "Library")
	if err != nil {
		t.Fatal(err)
	}
	if err := catalog.New(db).SetMember(ctx, admin, library.ID, reader.ID, "reader", true); err != nil {
		t.Fatal(err)
	}
	if err := catalog.New(db).SetMember(ctx, admin, library.ID, editor.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('ebook-source',?,'local','Ebooks','/ebooks',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),('disabled-source',?,'local','Disabled','/disabled',0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`, library.ID, library.ID); err != nil {
		t.Fatal(err)
	}
	store := NewPolicyStore(db)
	defaults, err := store.Get(ctx, admin, library.ID)
	if err != nil || defaults.MaxEbookBytes != defaultMaxEbookBytes || defaults.MaxAudiobookBytes != defaultMaxAudiobookBytes || defaults.PreferredLanguage != "en" || defaults.MaxActiveRequests != 5 {
		t.Fatalf("defaults = %#v, %v", defaults, err)
	}
	if _, err := store.Get(ctx, reader, library.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("reader get = %v", err)
	}
	if _, err := store.Get(ctx, editor, library.ID); err != nil {
		t.Fatalf("editor get = %v", err)
	}
	value := Policy{LibraryID: library.ID, DefaultEbookSourceID: "ebook-source", MaxEbookBytes: 50 << 20, MaxAudiobookBytes: 2 << 30, AllowedEbookExtensions: []string{".EPUB", "pdf", "epub"}, AllowedAudiobookExtensions: []string{"MP3", "m4b"}, PreferredLanguage: "EN-US", AllowAbridged: true, MaxActiveRequests: 3}
	saved, err := store.Update(ctx, admin, value)
	if err != nil {
		t.Fatal(err)
	}
	if saved.PreferredLanguage != "en-us" || len(saved.AllowedEbookExtensions) != 2 || saved.AllowedEbookExtensions[0] != "epub" || saved.AllowedEbookExtensions[1] != "pdf" {
		t.Fatalf("normalized policy = %#v", saved)
	}
	loaded, err := store.Get(ctx, admin, library.ID)
	if err != nil || loaded.DefaultEbookSourceID != "ebook-source" || !loaded.AllowAbridged || loaded.MaxActiveRequests != 3 {
		t.Fatalf("loaded policy = %#v, %v", loaded, err)
	}
	value.DefaultEbookSourceID = "disabled-source"
	if _, err := store.Update(ctx, admin, value); !errors.Is(err, ErrInvalid) {
		t.Fatalf("disabled source update = %v", err)
	}
	value.DefaultEbookSourceID = ""
	value.MaxActiveRequests = 101
	if _, err := store.Update(ctx, admin, value); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsafe limit update = %v", err)
	}
}
