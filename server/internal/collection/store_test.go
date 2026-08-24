package collection

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestPersonalCollectionCRUDOrderingAndVisibility(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS collections_user_id ON collections(user_id,updated_at DESC); CREATE TABLE IF NOT EXISTS collection_works(collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,position INTEGER NOT NULL CHECK(position>=0),added_at TEXT NOT NULL,PRIMARY KEY(collection_id,work_id),UNIQUE(collection_id,position))`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('one','one','one','One','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),('two','two','two','Two','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	one, two := auth.User{ID: "one"}, auth.User{ID: "two"}
	catalogStore := catalog.New(db)
	oneLibrary, err := catalogStore.CreateLibrary(ctx, one, "One")
	if err != nil {
		t.Fatal(err)
	}
	twoLibrary, err := catalogStore.CreateLibrary(ctx, two, "Two")
	if err != nil {
		t.Fatal(err)
	}
	first, _ := catalogStore.CreateWork(ctx, one, oneLibrary.ID, "First", "Author")
	second, _ := catalogStore.CreateWork(ctx, one, oneLibrary.ID, "Second", "Author")
	private, _ := catalogStore.CreateWork(ctx, two, twoLibrary.ID, "Private", "Author")
	store := New(db)
	created, err := store.Create(ctx, one, " Favorites ", " Good books ")
	if err != nil || created.Title != "Favorites" || created.Description != "Good books" {
		t.Fatalf("create = %#v, %v", created, err)
	}
	if _, err := store.Get(ctx, two, created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user get = %v", err)
	}
	if err := store.AddWork(ctx, one, created.ID, private.ID); !errors.Is(err, ErrInvalid) {
		t.Fatalf("add invisible work = %v", err)
	}
	if err := catalogStore.SetMember(ctx, two, twoLibrary.ID, one.ID, "reader"); err != nil {
		t.Fatal(err)
	}
	if err := store.AddWork(ctx, one, created.ID, private.ID); err != nil {
		t.Fatal(err)
	}
	if err := catalogStore.RemoveMember(ctx, two, twoLibrary.ID, one.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.AddWork(ctx, one, created.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.AddWork(ctx, one, created.ID, second.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.Reorder(ctx, one, created.ID, []string{second.ID, first.ID}); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Get(ctx, one, created.ID)
	if err != nil || loaded.WorkCount != 2 || loaded.Works[0].ID != second.ID || loaded.Works[0].Position != 0 || loaded.Works[1].ID != first.ID {
		t.Fatalf("ordered collection = %#v, %v", loaded, err)
	}
	if err := store.Reorder(ctx, one, created.ID, []string{first.ID}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("incomplete reorder = %v", err)
	}
	if err := store.RemoveWork(ctx, one, created.ID, second.ID); err != nil {
		t.Fatal(err)
	}
	loaded, err = store.Update(ctx, one, created.ID, "Renamed", "")
	if err != nil || loaded.Title != "Renamed" || loaded.WorkCount != 1 || loaded.Works[0].Position != 0 {
		t.Fatalf("updated collection = %#v, %v", loaded, err)
	}
	listed, err := store.List(ctx, one)
	if err != nil || len(listed) != 1 || listed[0].WorkCount != 1 {
		t.Fatalf("list = %#v, %v", listed, err)
	}
	if err := store.Delete(ctx, two, created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user delete = %v", err)
	}
	if err := store.Delete(ctx, one, created.ID); err != nil {
		t.Fatal(err)
	}
}

func TestExclusiveMembershipHidesAdditiveCollectionWorks(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('owner','owner','owner','Owner','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),('reader','reader','reader','Reader','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	owner, reader := auth.User{ID: "owner"}, auth.User{ID: "reader"}
	catalogStore := catalog.New(db)
	additive, _ := catalogStore.CreateLibrary(ctx, owner, "Family")
	exclusive, _ := catalogStore.CreateLibrary(ctx, owner, "Kids")
	if err := catalogStore.SetMember(ctx, owner, additive.ID, reader.ID, "reader"); err != nil {
		t.Fatal(err)
	}
	if err := catalogStore.SetMember(ctx, owner, exclusive.ID, reader.ID, "reader"); err != nil {
		t.Fatal(err)
	}
	additiveWork, _ := catalogStore.CreateWork(ctx, owner, additive.ID, "Parent book", "Author")
	exclusiveWork, _ := catalogStore.CreateWork(ctx, owner, exclusive.ID, "Kids book", "Author")
	store := New(db)
	collection, _ := store.Create(ctx, reader, "Shelf", "")
	if err := store.AddWork(ctx, reader, collection.ID, additiveWork.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.AddWork(ctx, reader, collection.ID, exclusiveWork.ID); err != nil {
		t.Fatal(err)
	}
	if err := catalogStore.SetMember(ctx, owner, exclusive.ID, reader.ID, "reader", false, false, false, true); err != nil {
		t.Fatal(err)
	}

	loaded, err := store.Get(ctx, reader, collection.ID)
	if err != nil || loaded.WorkCount != 1 || loaded.Works[0].ID != exclusiveWork.ID {
		t.Fatalf("exclusive collection = %#v, %v", loaded, err)
	}
	listed, err := store.List(ctx, reader)
	if err != nil || len(listed) != 1 || listed[0].WorkCount != 1 {
		t.Fatalf("exclusive collection count = %#v, %v", listed, err)
	}
	if err := store.AddWork(ctx, reader, collection.ID, additiveWork.ID); !errors.Is(err, ErrInvalid) {
		t.Fatalf("re-add hidden work = %v", err)
	}
}
