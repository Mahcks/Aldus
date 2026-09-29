package backup

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/position"
)

func TestLiveBackupExcludesChangingWorkingFiles(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	db, err := database.Open(ctx, filepath.Join(dataDir, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if err := position.New(db).SeedFixture(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO users (
			id, username, username_normalized, display_name, password_hash,
			is_admin, disabled, created_at, updated_at
		) VALUES ('reader', 'reader', 'reader', 'Reader', 'hash', 0, 0, '2026-01-01', '2026-01-01');
		INSERT INTO progress (
			user_id, work_id, alignment_id, segment_id, offset, revision, updated_at, source_device
		) VALUES ('reader', 'fixture-work', 'fixture-alignment', 's0002', 350000, 7, '2026-01-01', 'phone');
		INSERT INTO alignment_jobs (
			id, alignment_id, epub_media_id, audio_media_id, state, worker_version, model, artifact_id, created_at
		) VALUES ('published', 'fixture-alignment', 'fixture-epub', 'fixture-audio', 'ready', 'test', 'test', 'artifact', '2026-01-01');
		INSERT INTO alignment_jobs (
			id, epub_media_id, audio_media_id, state, worker_version, model, created_at
		) VALUES ('running', 'fixture-epub', 'fixture-audio', 'processing', 'next', 'test', '2026-01-01');
		INSERT INTO alignment_jobs (
			id, epub_media_id, audio_media_id, state, worker_version, model, artifact_id, created_at
		) VALUES ('stale', 'fixture-epub', 'fixture-audio', 'stale', 'old', 'test', 'old-artifact', '2026-01-01');
	`); err != nil {
		t.Fatal(err)
	}

	durable := []string{
		"media/media/fixture/book.epub",
		"media/media/fixture/book.m4b",
		"custom/media/book.epub",
		"acquisitions/library/request/file-000001.epub",
		"alignments/published/alignment.json",
		"alignments/stale/alignment.json",
		// Reserved-looking filenames outside their working directories are data.
		"notes/worker.log",
		"notes/progress.json",
		"notes/.aldus-ready-book",
	}
	working := []string{
		"media/staging/upload-first",
		"custom/staging/upload-second",
		"staging/upload-root",
		".aldus-ready-probe",
		".aldus-diagnostic-probe",
		"acquisitions/library/.acquisition-pending/file-000001.epub",
		"alignments/published/input.json",
		"alignments/published/worker.log",
		"alignments/published/progress.json",
		"alignments/published/progress.json.tmp",
		"alignments/published/stages.json",
		"alignments/published/stages.tmp",
		"alignments/published/runtime.json",
		"alignments/published/checkpoints/transcription.json",
		"alignments/published/checkpoints/transcription.tmp",
		"alignments/running/alignment.json",
		"alignments/running/worker.log",
		"alignments/matplotlib/fontlist.json",
		"alignments/models/cache.bin",
		"models/cache.bin",
	}
	for _, names := range [][]string{durable, working} {
		for _, name := range names {
			path := filepath.Join(dataDir, filepath.FromSlash(name))
			if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(name), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}

	archive := filepath.Join(t.TempDir(), "backup.tar.gz")
	if err := Create(ctx, dataDir, archive, "test"); err != nil {
		t.Fatal(err)
	}
	extracted := t.TempDir()
	manifest, err := extractAndVerify(ctx, archive, extracted, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range working {
		if _, included := manifest.Files[name]; included {
			t.Errorf("backup includes working file %q", name)
		}
	}

	// Advance the live worker after the snapshot, then collect paths and
	// remove/replace temporary files before archiving. This forces the race's
	// interleaving without sleeps, goroutines, or production test hooks.
	if _, err := db.ExecContext(ctx, `
		UPDATE alignment_jobs
		SET state = 'ready', artifact_id = 'new-artifact'
		WHERE id = 'running'
	`); err != nil {
		t.Fatal(err)
	}

	snapshot := filepath.Join(extracted, "aldus.db")
	files, err := backupFiles(ctx, dataDir, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	for name, path := range files {
		hash, err := fileHash(path)
		if err != nil {
			t.Fatal(err)
		}
		manifest.Files[name] = hash
	}
	for i, name := range working {
		path := filepath.Join(dataDir, filepath.FromSlash(name))
		if i%2 == 0 {
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
		} else if err := os.WriteFile(path, []byte("changed while backing up"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	interleaved := filepath.Join(t.TempDir(), "interleaved.tar.gz")
	if err := writeArchive(interleaved, manifest, files); err != nil {
		t.Fatal(err)
	}
	if err := Verify(ctx, interleaved); err != nil {
		t.Fatal(err)
	}
	restored := t.TempDir()
	if err := Restore(ctx, interleaved, restored); err != nil {
		t.Fatal(err)
	}
	for _, name := range durable {
		data, err := os.ReadFile(filepath.Join(restored, filepath.FromSlash(name)))
		if err != nil || string(data) != name {
			t.Errorf("restored %q = %q, %v", name, data, err)
		}
	}
	for _, name := range working {
		if _, err := os.Stat(filepath.Join(restored, filepath.FromSlash(name))); !os.IsNotExist(err) {
			t.Errorf("restored working file %q: %v", name, err)
		}
	}

	restoredDB, err := database.Open(ctx, filepath.Join(restored, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer restoredDB.Close()

	var username, segment string
	var offset, revision int
	if err := restoredDB.QueryRowContext(ctx, `
		SELECT u.username, p.segment_id, p.offset, p.revision
		FROM progress p
		JOIN users u ON u.id = p.user_id
		WHERE p.work_id = 'fixture-work'
	`).Scan(&username, &segment, &offset, &revision); err != nil {
		t.Fatal(err)
	}
	if username != "reader" || segment != "s0002" || offset != 350000 || revision != 7 {
		t.Fatalf("restored position = %s %s %d revision %d", username, segment, offset, revision)
	}
	if _, err := position.New(restoredDB).CanonicalToAudio(ctx, position.Canonical{
		AlignmentID: position.FixtureAlignmentID,
		SegmentID:   segment,
		Offset:      offset,
	}); err != nil {
		t.Fatalf("resolve restored alignment: %v", err)
	}

	var state string
	if err := restoredDB.QueryRowContext(ctx, `
		SELECT state FROM alignment_jobs WHERE id = 'running'
	`).Scan(&state); err != nil || state != "processing" {
		t.Fatalf("restored worker state = %q, %v", state, err)
	}
}

func TestBackupLeavesOlderSourceUnchanged(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	path := filepath.Join(dataDir, "aldus.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		CREATE TABLE original (value TEXT);
		INSERT INTO original VALUES ('preserve me');
		PRAGMA user_version = 1;
	`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "backup.tar.gz")
	if err := Create(ctx, dataDir, archive, "newer"); err == nil || !strings.Contains(err.Error(), "release that created this database") {
		t.Fatalf("older schema backup error = %v", err)
	}

	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("backup changed the older live database")
	}
	if _, err := os.Stat(archive); !os.IsNotExist(err) {
		t.Fatalf("failed backup left an archive: %v", err)
	}
}

func TestVerificationStreamsMediaWithoutDefaultTemporaryDirectory(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	db, err := database.Open(ctx, filepath.Join(dataDir, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "book.m4b"), bytes.Repeat([]byte("media"), 100000), 0o600); err != nil {
		t.Fatal(err)
	}

	archive := filepath.Join(t.TempDir(), "backup.tar.gz")
	// Backup verification must work even when the default temporary directory
	// cannot hold files. The archive's filesystem supplies the SQLite workspace.
	t.Setenv("TMPDIR", filepath.Join(dataDir, "missing"))
	if err := Create(ctx, dataDir, archive, "test"); err != nil {
		t.Fatal(err)
	}

	extracted := t.TempDir()
	if _, err := extractAndVerify(ctx, archive, extracted, false); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(extracted)
	if err != nil || len(entries) != 1 || entries[0].Name() != "aldus.db" {
		t.Fatalf("verification extracted files other than SQLite: %v, %v", entries, err)
	}
}

func TestArchiveVerificationRejectsInvalidEntries(t *testing.T) {
	for _, test := range []struct {
		name      string
		entry     string
		typeflag  byte
		duplicate bool
		badHash   bool
	}{
		{name: "traversal", entry: "../outside", typeflag: tar.TypeReg},
		{name: "symlink", entry: "link", typeflag: tar.TypeSymlink},
		{name: "duplicate", entry: "book.m4b", typeflag: tar.TypeReg, duplicate: true},
		{name: "checksum", entry: "book.m4b", typeflag: tar.TypeReg, badHash: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			archive := filepath.Join(t.TempDir(), "invalid.tar.gz")
			file, err := os.Create(archive)
			if err != nil {
				t.Fatal(err)
			}
			compressed := gzip.NewWriter(file)
			writer := tar.NewWriter(compressed)
			data := []byte("archive content")
			hash := sha256.Sum256(data)
			manifest := Manifest{Files: map[string]string{
				"aldus.db": hex.EncodeToString(hash[:]),
				test.entry: hex.EncodeToString(hash[:]),
			}}
			if test.badHash {
				manifest.Files[test.entry] = "wrong"
			}
			encoded, err := json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			if err := writeBytes(writer, manifestName, encoded, 0o600); err != nil {
				t.Fatal(err)
			}
			if err := writeBytes(writer, "aldus.db", data, 0o600); err != nil {
				t.Fatal(err)
			}

			count := 1
			if test.duplicate {
				count = 2
			}
			for range count {
				header := &tar.Header{Name: test.entry, Typeflag: test.typeflag, Mode: 0o600}
				if test.typeflag == tar.TypeReg {
					header.Size = int64(len(data))
				}
				if err := writer.WriteHeader(header); err != nil {
					t.Fatal(err)
				}
				if test.typeflag == tar.TypeReg {
					if _, err := writer.Write(data); err != nil {
						t.Fatal(err)
					}
				}
			}
			for _, close := range []func() error{writer.Close, compressed.Close, file.Close} {
				if err := close(); err != nil {
					t.Fatal(err)
				}
			}

			for _, extractMedia := range []bool{false, true} {
				if _, err := extractAndVerify(context.Background(), archive, t.TempDir(), extractMedia); err == nil {
					t.Fatalf("invalid archive accepted, extractMedia=%v", extractMedia)
				}
			}
		})
	}
}
