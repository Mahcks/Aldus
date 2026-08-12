package position

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

func TestMigrationCreatesAndReopensVersionOne(t *testing.T) {
	ctx := context.Background()
	path := t.TempDir() + "/aldus.db"
	store, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if version := schemaVersion(t, store.db); version != 1 {
		t.Fatalf("schema version = %d, want 1", version)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if version := schemaVersion(t, store.db); version != 1 {
		t.Fatalf("schema version after reopen = %d, want 1", version)
	}
}

func TestMigrationPreservesExistingVersionOne(t *testing.T) {
	ctx := context.Background()
	path := t.TempDir() + "/aldus.db"
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	legacy := schema + `
PRAGMA user_version = 1;
INSERT INTO works (id, title) VALUES ('work', 'Alice');
INSERT INTO media (id, work_id, kind, path, sha256, created_at) VALUES
 ('epub', 'work', 'epub', 'alice.epub', '` + strings.Repeat("a", 64) + `', '2026-08-12T00:00:00Z'),
 ('audio', 'work', 'audio', 'alice.mp3', '` + strings.Repeat("b", 64) + `', '2026-08-12T00:00:00Z');
INSERT INTO koreader_aliases (document_id, media_id) VALUES ('document', 'epub');
INSERT INTO alignments (id, epub_media_id, audio_media_id, revision, state, created_at)
 VALUES ('alignment', 'epub', 'audio', 1, 'ready', '2026-08-12T00:00:00Z');
INSERT INTO alignment_segments
 (alignment_id, id, ordinal, text, epub_href, epub_locator, koreader_locator, audio_resource, audio_start_ms, audio_end_ms)
 VALUES ('alignment', 'segment', 0, 'Alice', 'chapter.xhtml', '{"type":"epubcfi","value":"epubcfi(/6/2)"}', '/body/p[1]', 'alice.mp3', 100, 500);
INSERT INTO progress (alignment_id, segment_id, offset, revision, updated_at, source_device)
 VALUES ('alignment', 'segment', 250000, 1, '2026-08-12T00:00:00Z', 'web');`
	if _, err := db.ExecContext(ctx, legacy); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	alignment, err := store.Alignment(ctx, "alignment")
	if err != nil || len(alignment.Segments) != 1 || alignment.Segments[0].Text != "Alice" {
		t.Fatalf("alignment after migration = %#v, %v", alignment, err)
	}
	progress, err := store.Progress(ctx, "alignment")
	if err != nil || progress.SegmentID != "segment" || progress.Offset != 250000 || progress.Revision != 1 {
		t.Fatalf("progress after migration = %#v, %v", progress, err)
	}
	var tableCount int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('works','media','koreader_aliases','alignments','alignment_segments','progress')`).Scan(&tableCount); err != nil || tableCount != 6 {
		t.Fatalf("preserved tables = %d, %v", tableCount, err)
	}
	var violation string
	if err := store.db.QueryRowContext(ctx, `PRAGMA foreign_key_check`).Scan(&violation); err != sql.ErrNoRows {
		t.Fatalf("foreign key check = %q, %v", violation, err)
	}
}

func TestMigrationRejectsNewerDatabase(t *testing.T) {
	path := t.TempDir() + "/aldus.db"
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA user_version = 2`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	_, err = Open(context.Background(), path)
	if err == nil || !strings.Contains(err.Error(), "schema version 2 is newer than supported version 1") {
		t.Fatalf("Open error = %v", err)
	}
}

func TestMigrationRollsBackFailedVersion(t *testing.T) {
	ctx := context.Background()
	path := t.TempDir() + "/aldus.db"
	store, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	original := migrations
	migrations = append(append([]string{}, migrations...), `CREATE TABLE partial (id TEXT); SELECT nope FROM missing;`)
	t.Cleanup(func() { migrations = original })
	if err := migrate(ctx, store.db); err == nil {
		t.Fatal("failed migration succeeded")
	}
	if version := schemaVersion(t, store.db); version != 1 {
		t.Fatalf("schema version after rollback = %d, want 1", version)
	}
	var exists int
	if err := store.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'partial')`).Scan(&exists); err != nil || exists != 0 {
		t.Fatalf("partial migration table exists = %d, %v", exists, err)
	}
	store.Close()
}

func schemaVersion(t *testing.T, db *sql.DB) int {
	t.Helper()
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	return version
}
