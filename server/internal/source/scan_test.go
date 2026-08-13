package source

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestAliceScanIsIdempotentAndReconcilesChanges(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,?,?); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library',?,?)`, now, now, now, now)
	if err != nil {
		t.Fatal(err)
	}
	allowed := t.TempDir()
	root := filepath.Join(allowed, "books")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	copyFile(t, filepath.Join("..", "..", "..", "test-fixtures", "alice", "media", "alice.epub"), filepath.Join(root, "alice.epub"))
	copyFile(t, filepath.Join("..", "..", "..", "test-fixtures", "alice", "media", "alice-chapter-01.mp3"), filepath.Join(root, "alice.mp3"))
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("ignored"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(allowed, "outside.mp3"), filepath.Join(root, "linked.mp3")); err != nil {
		t.Fatal(err)
	}
	store, err := New(db, Options{AllowedRoots: []string{allowed}, ManagedRoot: t.TempDir(), MaxBytes: 16 << 20})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := store.Create(ctx, auth.User{ID: "admin", Admin: true}, "library", "Alice", root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueScan(ctx, auth.User{ID: "admin", Admin: true}, "library", saved.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueScan(ctx, auth.User{ID: "admin", Admin: true}, "library", saved.ID); err != ErrActiveScan {
		t.Fatalf("simultaneous scan = %v", err)
	}
	if _, err := db.Exec(`DELETE FROM source_scans WHERE source_id=?`, saved.ID); err != nil {
		t.Fatal(err)
	}
	first := runTestScan(t, store, saved.ID, "scan-1")
	if first.FilesVisited != 3 || first.Supported != 2 || first.EPUB != 1 || first.Audio != 1 || first.New != 2 || first.Problems != 0 {
		t.Fatalf("first scan=%+v", first)
	}
	entries, err := store.Entries(ctx, auth.User{ID: "admin", Admin: true}, "library", saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("entries=%d", len(entries))
	}
	hashes := map[string]string{}
	for _, entry := range entries {
		hashes[entry.RelativePath] = entry.SHA256
		if entry.Kind == "epub" && !strings.Contains(string(entry.Metadata), "Alice's Adventures in Wonderland") {
			t.Fatalf("EPUB metadata=%s", entry.Metadata)
		}
		if entry.Kind == "audio" && !strings.Contains(string(entry.Metadata), "864253") {
			t.Fatalf("audio metadata=%s", entry.Metadata)
		}
	}
	if hashes["alice.epub"] != "6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c" || hashes["alice.mp3"] != "6c58be3679f82e5d20b2c5efea6f377ee0ed985a4e2b4dbd5201ea656312757a" {
		t.Fatalf("hashes=%v", hashes)
	}
	second := runTestScan(t, store, saved.ID, "scan-2")
	if second.Unchanged != 2 || second.New != 0 || second.Changed != 0 {
		t.Fatalf("second scan=%+v", second)
	}
	f, err := os.OpenFile(filepath.Join(root, "alice.mp3"), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Write([]byte{0}); err != nil {
		t.Fatal(err)
	}
	f.Close()
	changed := runTestScan(t, store, saved.ID, "scan-3")
	if changed.Changed != 1 || changed.Unchanged != 1 {
		t.Fatalf("changed scan=%+v", changed)
	}
	if err := os.Remove(filepath.Join(root, "alice.mp3")); err != nil {
		t.Fatal(err)
	}
	missing := runTestScan(t, store, saved.ID, "scan-4")
	if missing.Missing != 1 || missing.Supported != 1 {
		t.Fatalf("missing scan=%+v", missing)
	}
	if _, err := db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at,started_at) VALUES('interrupted',?,'scanning',?,?)`, saved.ID, now, now); err != nil {
		t.Fatal(err)
	}
	if err := store.recoverScans(ctx); err != nil {
		t.Fatal(err)
	}
	var recovered string
	if err := db.QueryRow(`SELECT state FROM source_scans WHERE id='interrupted'`).Scan(&recovered); err != nil || recovered != "pending" {
		t.Fatalf("recovered=%q, %v", recovered, err)
	}
}

func TestInspectionAndHashingRejectInvalidOversizedAndCanceledInput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.epub")
	if err := os.WriteFile(path, []byte("not an epub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectEPUB(path, 1024); err == nil {
		t.Fatal("corrupt EPUB accepted")
	}
	if _, err := hashPath(context.Background(), path, 2); err == nil {
		t.Fatal("oversized file accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := hashPath(ctx, path, 1024); err != context.Canceled {
		t.Fatalf("canceled hash=%v", err)
	}
}

func runTestScan(t *testing.T, store *Store, sourceID, id string) Scan {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := store.db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at,started_at) VALUES(?,?,'scanning',?,?)`, id, sourceID, now, now); err != nil {
		t.Fatal(err)
	}
	if err := store.runScan(ctx, Scan{ID: id, SourceID: sourceID}); err != nil {
		t.Fatal(err)
	}
	scans, err := store.Scans(ctx, auth.User{ID: "admin", Admin: true}, "library", sourceID)
	if err != nil {
		t.Fatal(err)
	}
	return scans[0]
}
func copyFile(t *testing.T, from, to string) {
	t.Helper()
	source, err := os.Open(from)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	target, err := os.Create(to)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(target, source); err != nil {
		target.Close()
		t.Fatal(err)
	}
	if err := target.Close(); err != nil {
		t.Fatal(err)
	}
}
