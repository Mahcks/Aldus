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
	if err := catalogStore.SetMember(ctx, auth.User{ID: two.ID, Admin: true}, twoLibrary.ID, one.ID, "reader"); err != nil {
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
	admin := auth.User{ID: owner.ID, Admin: true}
	catalogStore := catalog.New(db)
	additive, _ := catalogStore.CreateLibrary(ctx, owner, "Family")
	exclusive, _ := catalogStore.CreateLibrary(ctx, owner, "Kids")
	if err := catalogStore.SetMember(ctx, admin, additive.ID, reader.ID, "reader"); err != nil {
		t.Fatal(err)
	}
	if err := catalogStore.SetMember(ctx, admin, exclusive.ID, reader.ID, "reader"); err != nil {
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

func TestSharedCollectionsRespectBothReadersAndCreatorAccess(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "family.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, id := range []string{"admin", "parent", "child", "outsider"} {
		_, err := db.ExecContext(ctx, `INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES(?,?,?,?,?, ?,0,'2026-01-01','2026-01-01')`, id, id, id, id, "test", id == "admin")
		if err != nil {
			t.Fatal(err)
		}
	}
	admin, parent, child, outsider := auth.User{ID: "admin", Admin: true}, auth.User{ID: "parent"}, auth.User{ID: "child"}, auth.User{ID: "outsider"}
	catalogStore := catalog.New(db)
	library, err := catalogStore.CreateLibrary(ctx, admin, "Family")
	if err != nil {
		t.Fatal(err)
	}
	other, err := catalogStore.CreateLibrary(ctx, admin, "Other")
	if err != nil {
		t.Fatal(err)
	}
	for _, user := range []auth.User{parent, child} {
		if err := catalogStore.SetMember(ctx, admin, library.ID, user.ID, "reader"); err != nil {
			t.Fatal(err)
		}
	}
	first, err := catalogStore.CreateWork(ctx, admin, library.ID, "First", "Author")
	if err != nil {
		t.Fatal(err)
	}
	second, err := catalogStore.CreateWork(ctx, admin, library.ID, "Second", "Author")
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := catalogStore.CreateWork(ctx, admin, other.ID, "Private", "Author")
	if err != nil {
		t.Fatal(err)
	}
	store := New(db)
	list, err := store.Create(ctx, parent, "Bedtime", "Family reading")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{first.ID, second.ID} {
		if err := store.AddWork(ctx, parent, list.ID, id); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Share(ctx, child, list.ID, library.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("noncreator publish: %v", err)
	}
	if err := store.Share(ctx, parent, list.ID, library.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(ctx, child, list.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old private endpoint broadened: %v", err)
	}
	got, err := store.SharedDetail(ctx, child, list.ID)
	if err != nil || got.CanEdit || got.WorkCount != 2 || got.Works[0].ID != first.ID {
		t.Fatalf("shared detail: %#v %v", got, err)
	}
	if _, err := store.SharedDetail(ctx, outsider, list.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider read: %v", err)
	}
	if err := store.RemoveWork(ctx, child, list.ID, first.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("recipient edit: %v", err)
	}
	if err := catalogStore.SetMember(ctx, admin, other.ID, parent.ID, "reader"); err != nil {
		t.Fatal(err)
	}
	if err := store.AddWork(ctx, parent, list.ID, foreign.ID); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross library addition: %v", err)
	}
	if err := catalogStore.SetMember(ctx, admin, other.ID, child.ID, "reader", false, false, false, true); err != nil {
		t.Fatal(err)
	}
	if values, err := store.Shared(ctx, child, 100, 0); err != nil || len(values) != 0 {
		t.Fatalf("exclusive shared list: %#v %v", values, err)
	}
	if err := catalogStore.RemoveMember(ctx, admin, other.ID, child.ID); err != nil {
		t.Fatal(err)
	}
	if err := catalogStore.RemoveMember(ctx, admin, library.ID, parent.ID); err != nil {
		t.Fatal(err)
	}
	if values, err := store.Shared(ctx, child, 100, 0); err != nil || len(values) != 0 {
		t.Fatalf("revoked creator list: %#v %v", values, err)
	}
	if _, err := store.SharedDetail(ctx, child, list.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked creator detail: %v", err)
	}
	if err := store.AddWork(ctx, parent, list.ID, second.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked creator edit: %v", err)
	}
	if err := store.Share(ctx, parent, list.ID, ""); err != nil {
		t.Fatalf("owner unshare recovery: %v", err)
	}
	if _, err := store.Get(ctx, parent, list.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SharedDetail(ctx, child, list.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unpublished detail: %v", err)
	}
}
