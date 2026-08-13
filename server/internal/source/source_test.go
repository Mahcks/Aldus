package source

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestSourcesAndReferencedMediaStayInsideAllowedRoots(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,?,?),('reader','reader','reader','Reader','x',0,0,?,?); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library',?,?); INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('library','reader','owner',?); INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('work','library','Book',?,?); INSERT INTO representations(id,work_id,kind,label,created_at,updated_at) VALUES('rep','work','audio','Audio',?,?)`, now, now, now, now, now, now, now, now, now, now, now)
	if err != nil {
		t.Fatal(err)
	}
	allowed := t.TempDir()
	root := filepath.Join(allowed, "books")
	managed := filepath.Join(t.TempDir(), "managed")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	store, err := New(db, Options{AllowedRoots: []string{allowed}, ManagedRoot: managed})
	if err != nil {
		t.Fatal(err)
	}
	admin := auth.User{ID: "admin", Admin: true}
	reader := auth.User{ID: "reader"}
	if _, err := store.Create(ctx, reader, "library", "Books", root); err != ErrNotFound {
		t.Fatalf("reader create = %v", err)
	}
	for _, unsafe := range []string{allowed + "-sibling", filepath.Join(root, "..", ".."), managed} {
		if _, err := store.Create(ctx, admin, "library", "Unsafe", unsafe); err != ErrInvalid {
			t.Fatalf("create %q = %v", unsafe, err)
		}
	}
	symlink := filepath.Join(allowed, "linked")
	if err := os.Symlink(root, symlink); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(ctx, admin, "library", "Linked", symlink); err != ErrInvalid {
		t.Fatalf("symlink root = %v", err)
	}
	source, err := store.Create(ctx, admin, "library", "Books", root)
	if err != nil {
		t.Fatal(err)
	}
	bytes := []byte("0123456789")
	path := filepath.Join(root, "chapter.mp3")
	if err := os.WriteFile(path, bytes, 0o644); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(path)
	sum := sha256.Sum256(bytes)
	hash := hex.EncodeToString(sum[:])
	_, err = db.Exec(`INSERT INTO source_entries(id,source_id,relative_path,size_bytes,modified_at,sha256,state,created_at,updated_at) VALUES('entry',?,'chapter.mp3',?,?,?,'registered',?,?)`, source.ID, len(bytes), info.ModTime().UTC().Format(time.RFC3339Nano), hash, now, now)
	if err == nil {
		_, err = db.Exec(`INSERT INTO media(id,representation_id,kind,path,sha256,created_at,original_filename,size_bytes,storage_kind,source_entry_id) VALUES('media','rep','audio','',?,?,'chapter.mp3',?,'referenced','entry')`, hash, now, len(bytes))
	}
	if err != nil {
		t.Fatal(err)
	}
	file, err := store.OpenMedia(ctx, "media", true)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(file)
	file.Close()
	if string(got) != string(bytes) {
		t.Fatalf("bytes = %q", got)
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("x", len(bytes))), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.OpenMedia(ctx, "media", true); err != ErrUnavailable {
		t.Fatalf("changed media = %v", err)
	}
	if err := store.Update(ctx, admin, "library", source.ID, source.Name, source.RootPath, false); err != nil {
		t.Fatal(err)
	}
	if _, err := store.OpenMedia(ctx, "media", false); err != ErrUnavailable {
		t.Fatalf("disabled source = %v", err)
	}
	if err := store.Delete(ctx, admin, "library", source.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.OpenMedia(ctx, "media", false); err != ErrUnavailable {
		t.Fatalf("deleted source = %v", err)
	}
}
