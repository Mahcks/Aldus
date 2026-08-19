package source

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestManagedAcquisitionCopiesAtomicallyWithoutTorrentNames(t *testing.T) {
	ctx := context.Background()
	data := t.TempDir()
	db, err := database.Open(ctx, filepath.Join(data, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01','2026-01-01'); INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('user','user','user','User','x',1,0,'2026-01-01','2026-01-01')`); err != nil {
		t.Fatal(err)
	}
	store, err := New(db, Options{DataRoot: data})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.ensureManagedSource(ctx, "library")
	if err != nil {
		t.Fatal(err)
	}
	download := filepath.Join(t.TempDir(), "torrent-name")
	if err := os.Mkdir(download, 0o700); err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(download, "../../impossible")
	_ = original
	book := filepath.Join(download, "Alice (Uploader Name).EPUB")
	if err := os.WriteFile(book, []byte("book bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,created_at,updated_at) VALUES('request','library','user',?,'Alice','requested','2026-01-01','2026-01-01')`, source.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueAcquisitionScan(ctx, "library", source.ID, "request", download); err != nil {
		t.Fatal(err)
	}
	copied, err := os.ReadFile(filepath.Join(source.RootPath, "request", "file-000001.epub"))
	if err != nil || string(copied) != "book bytes" {
		t.Fatalf("managed copy=%q err=%v", copied, err)
	}
	if _, err := os.Stat(book); err != nil {
		t.Fatalf("original was removed: %v", err)
	}
	if _, err := store.EnqueueAcquisitionScan(ctx, "library", source.ID, "../escape", download); err == nil {
		t.Fatal("accepted traversal request id")
	}
}

func TestManagedAcquisitionCopyFailureLeavesNoPartialDirectory(t *testing.T) {
	root := t.TempDir()
	download := t.TempDir()
	if err := os.WriteFile(filepath.Join(download, "book.epub"), []byte("book"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("book.epub", filepath.Join(download, "linked.epub")); err != nil {
		t.Fatal(err)
	}
	if _, err := copyManagedDownload(root, "request", download); err == nil {
		t.Fatal("accepted symlink")
	}
	if _, err := os.Stat(filepath.Join(root, "request")); !os.IsNotExist(err) {
		t.Fatalf("partial acquisition remains: %v", err)
	}
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 0 {
		t.Fatalf("staging cleanup entries=%v err=%v", entries, err)
	}
}

func TestSourceListLazilyCreatesManagedDestinationWithoutExposingPath(t *testing.T) {
	ctx := context.Background()
	data := t.TempDir()
	db, err := database.Open(ctx, filepath.Join(data, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('owner','owner','owner','Owner','x',0,0,'2026-01-01','2026-01-01'); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('new-library','New','2026-01-01','2026-01-01'); INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('new-library','owner','owner','2026-01-01')`); err != nil {
		t.Fatal(err)
	}
	store, err := New(db, Options{DataRoot: data})
	if err != nil {
		t.Fatal(err)
	}
	sources, err := store.List(ctx, auth.User{ID: "owner"}, "new-library")
	if err != nil || len(sources) != 1 {
		t.Fatalf("sources=%v err=%v", sources, err)
	}
	if sources[0].StorageKind != "managed" || sources[0].RootPath != "" {
		t.Fatalf("managed source leaked path: %+v", sources[0])
	}
	again, err := store.List(ctx, auth.User{ID: "owner"}, "new-library")
	if err != nil || len(again) != 1 {
		t.Fatalf("idempotent list=%v err=%v", again, err)
	}
}
