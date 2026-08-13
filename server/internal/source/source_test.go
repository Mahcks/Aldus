package source

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
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
	if err := os.MkdirAll(managed, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(allowed+"-sibling", 0o755); err != nil {
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
		if _, err := store.Create(ctx, admin, "library", "Unsafe", unsafe); !errors.Is(err, ErrInvalid) {
			t.Fatalf("create %q = %v", unsafe, err)
		}
	}
	if _, err := store.Create(ctx, admin, "library", "Outside", allowed+"-sibling"); validationCode(err) != "outside_allowed_roots" {
		t.Fatalf("outside root code = %q, %v", validationCode(err), err)
	}
	if _, err := store.Create(ctx, admin, "library", "Managed", managed); validationCode(err) != "overlaps_aldus_storage" {
		t.Fatalf("managed overlap code = %q, %v", validationCode(err), err)
	}
	symlink := filepath.Join(allowed, "linked")
	if err := os.Symlink(root, symlink); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(ctx, admin, "library", "Linked", symlink); !errors.Is(err, ErrInvalid) {
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

func TestSourceRootDirectoryBrowser(t *testing.T) {
	allowed := t.TempDir()
	books := filepath.Join(allowed, "Books")
	nested := filepath.Join(books, "Classics")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(allowed, "not-a-folder"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(nested, filepath.Join(allowed, "Linked")); err != nil {
		t.Fatal(err)
	}
	store := &Store{allowedRoots: []string{allowed}}
	admin := auth.User{Admin: true}
	roots, err := store.Roots(admin)
	if err != nil || len(roots) != 1 || roots[0].Path != allowed {
		t.Fatalf("roots = %#v, %v", roots, err)
	}
	if values, err := store.Roots(auth.User{}); !errors.Is(err, ErrNotFound) || values != nil {
		t.Fatalf("non-admin roots = %#v, %v", values, err)
	}
	root, err := store.Directories(admin, roots[0].ID, "")
	if err != nil || root.HasParent || len(root.Directories) != 1 || root.Directories[0] != "Books" {
		t.Fatalf("root listing = %#v, %v", root, err)
	}
	child, err := store.Directories(admin, roots[0].ID, "Books")
	if err != nil || !child.HasParent || child.RelativePath != "Books" || child.AbsolutePath != books || len(child.Directories) != 1 {
		t.Fatalf("nested listing = %#v, %v", child, err)
	}
	for _, unsafe := range []string{"../outside", "/etc", "Linked"} {
		if _, err := store.Directories(admin, roots[0].ID, unsafe); !errors.Is(err, ErrInvalid) {
			t.Fatalf("browse %q = %v", unsafe, err)
		}
	}
	empty := &Store{}
	if roots, err := empty.Roots(admin); err != nil || len(roots) != 0 {
		t.Fatalf("empty roots = %#v, %v", roots, err)
	}
	if _, err := canonicalDirectory(filepath.Join(allowed, "missing")); validationCode(err) != "path_not_found" {
		t.Fatalf("missing code = %q, %v", validationCode(err), err)
	}
	if _, err := canonicalDirectory(filepath.Join(allowed, "not-a-folder")); validationCode(err) != "not_directory" {
		t.Fatalf("file code = %q, %v", validationCode(err), err)
	}
	if _, err := canonicalDirectory("relative/books"); validationCode(err) != "malformed_path" {
		t.Fatalf("relative code = %q, %v", validationCode(err), err)
	}
	if _, err := canonicalDirectory(string(filepath.Separator)); validationCode(err) != "unsafe_root" {
		t.Fatalf("volume root code = %q, %v", validationCode(err), err)
	}
	locked := filepath.Join(allowed, "Locked")
	if err := os.Mkdir(locked, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(locked, 0o755) })
	if _, err := canonicalDirectory(locked); validationCode(err) != "inaccessible" {
		t.Fatalf("inaccessible code = %q, %v", validationCode(err), err)
	}
}

func validationCode(err error) string {
	var value *ValidationError
	if errors.As(err, &value) {
		return value.Code
	}
	return ""
}
