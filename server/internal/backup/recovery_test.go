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
)

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
