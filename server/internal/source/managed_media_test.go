package source

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestAcquisitionScanOnlyVisitsRecordedPayload(t *testing.T) {
	ctx := context.Background()
	data := t.TempDir()
	db, err := database.Open(ctx, filepath.Join(data, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,?,?); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library',?,?)`, now, now, now, now); err != nil {
		t.Fatal(err)
	}
	allowed := t.TempDir()
	root := filepath.Join(allowed, "downloads")
	payload := filepath.Join(root, "requested-book")
	unrelated := filepath.Join(root, "someone-elses-book")
	if err := os.MkdirAll(payload, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(unrelated, 0o755); err != nil {
		t.Fatal(err)
	}
	fixture := filepath.Join("..", "..", "..", "test-fixtures", "alice", "media", "alice.epub")
	copyFile(t, fixture, filepath.Join(payload, "book.epub"))
	copyFile(t, fixture, filepath.Join(unrelated, "unrelated.epub"))
	store, err := New(db, Options{AllowedRoots: []string{allowed}, DataRoot: data, MaxBytes: 16 << 20})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := store.Create(ctx, auth.User{ID: "admin", Admin: true}, "library", "Downloads", root, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,download_state,fulfillment_state,created_at,updated_at) VALUES('request','library','admin',?,'Alice','queued','ready','scanning',?,?)`, saved.ID, now, now); err != nil {
		t.Fatal(err)
	}
	scanID, err := store.EnqueueAcquisitionScan(ctx, "library", saved.ID, "request", payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.runScan(ctx, Scan{ID: scanID, SourceID: saved.ID}); err != nil {
		t.Fatal(err)
	}
	var relative string
	if err := db.QueryRow(`SELECT completed_relative_path FROM acquisition_requests WHERE id='request'`).Scan(&relative); err != nil || relative != "requested-book" {
		t.Fatalf("payload=%q err=%v", relative, err)
	}
	var visited, unrelatedEntries int
	if err := db.QueryRow(`SELECT files_visited FROM source_scans WHERE id=?`, scanID).Scan(&visited); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM source_entries WHERE relative_path LIKE 'someone-elses-book/%'`).Scan(&unrelatedEntries); err != nil {
		t.Fatal(err)
	}
	if visited != 1 || unrelatedEntries != 0 {
		t.Fatalf("visited=%d unrelated entries=%d", visited, unrelatedEntries)
	}
}

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
	if _, err := copyManagedDownload(context.Background(), root, "request", download, 1<<20); err == nil {
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

func TestManagedAcquisitionRejectsOversizedDownload(t *testing.T) {
	root := t.TempDir()
	download := t.TempDir()
	if err := os.WriteFile(filepath.Join(download, "book.epub"), []byte("too large"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := copyManagedDownload(context.Background(), root, "request", download, 4); err == nil {
		t.Fatal("accepted oversized managed download")
	}
	if entries, err := os.ReadDir(root); err != nil || len(entries) != 0 {
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

func TestManagedCopyCancellationAndLimit(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(t.TempDir(), "book.epub")
	if err := os.WriteFile(source, []byte("book bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := copyManagedDownload(ctx, root, "request", source, 10); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled copy returned %v", err)
	}
	if entries, err := os.ReadDir(root); err != nil || len(entries) != 0 {
		t.Fatalf("partial files remain: %v, %v", entries, err)
	}
}

// The hook cancels synchronously at a filesystem milestone, without sleeps or
// racing a background writer against the copy.
type managedCopyContext struct {
	context.Context
	check func()
}

func (c managedCopyContext) Err() error {
	c.check()
	return c.Context.Err()
}

func TestManagedCopyPreservesSourceAndCleansCanceledStages(t *testing.T) {
	payload := bytes.Repeat([]byte("a"), 3*(128<<10))
	for _, phase := range []string{"copy", "checksum", "success", "oversize"} {
		t.Run(phase, func(t *testing.T) {
			root := t.TempDir()
			source := filepath.Join(t.TempDir(), "book.epub")
			if err := os.WriteFile(source, payload, 0o600); err != nil {
				t.Fatal(err)
			}

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			fullChecks := 0
			checked := managedCopyContext{Context: ctx, check: func() {
				stages, err := filepath.Glob(filepath.Join(root, ".acquisition-*", "*"))
				if err != nil || len(stages) == 0 {
					return
				}
				info, err := os.Stat(stages[0])
				if err != nil {
					t.Fatal(err)
				}
				if phase == "copy" && info.Size() == 128<<10 {
					cancel()
				}
				if phase == "checksum" && info.Size() == int64(len(payload)) {
					fullChecks++
					// Two checks finish the copy's EOF probe. The next checks
					// occur in hashPath, before its first and second chunks.
					if fullChecks == 4 {
						cancel()
					}
				}
			}}

			limit := int64(len(payload))
			if phase == "oversize" {
				limit--
			}
			final, err := copyManagedDownload(checked, root, "request", source, limit)
			if phase == "success" {
				if err != nil {
					t.Fatal(err)
				}
				copied, err := os.ReadFile(filepath.Join(final, "file-000001.epub"))
				if err != nil || sha256.Sum256(copied) != sha256.Sum256(payload) {
					t.Fatalf("copy differs: %v", err)
				}
				entries, err := os.ReadDir(root)
				if err != nil || len(entries) != 1 || entries[0].Name() != "request" {
					t.Fatalf("unexpected published files: %v, %v", entries, err)
				}
			} else {
				if err == nil {
					t.Fatal("failed copy succeeded")
				}
				if phase != "oversize" && !errors.Is(err, context.Canceled) {
					t.Fatalf("lost cancellation: %v", err)
				}
				if entries, err := os.ReadDir(root); err != nil || len(entries) != 0 {
					t.Fatalf("staging or final files remain: %v, %v", entries, err)
				}
			}
			original, err := os.ReadFile(source)
			if err != nil || !bytes.Equal(original, payload) {
				t.Fatalf("seed payload changed: %v", err)
			}
		})
	}
}

func TestManagedCopyBoundsStreamingInput(t *testing.T) {
	for _, limit := range []int64{0, 128 << 10, math.MaxInt64} {
		t.Run(fmt.Sprint(limit), func(t *testing.T) {
			payload := bytes.Repeat([]byte("x"), (128<<10)+100)
			reader := bytes.NewReader(payload)
			var target bytes.Buffer
			written, err := copyBounded(context.Background(), &target, reader, limit)
			consumed := int64(len(payload) - reader.Len())
			if limit < int64(len(payload)) {
				if err == nil || written > limit || consumed > limit+1 {
					t.Fatalf("limit=%d written=%d consumed=%d err=%v", limit, written, consumed, err)
				}
			} else if err != nil || !bytes.Equal(target.Bytes(), payload) {
				t.Fatalf("valid copy failed: %v", err)
			}
		})
	}

	ctx, cancel := context.WithCancel(context.Background())
	reader := cancelingCopyReader{Reader: bytes.NewReader([]byte("book")), cancel: cancel}
	var target bytes.Buffer
	if _, err := copyBounded(ctx, &target, reader, 4); !errors.Is(err, context.Canceled) || target.Len() != 0 {
		t.Fatalf("wrote after cancellation: bytes=%d err=%v", target.Len(), err)
	}
}

type cancelingCopyReader struct {
	io.Reader
	cancel context.CancelFunc
}

func (r cancelingCopyReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	r.cancel()
	return n, err
}
