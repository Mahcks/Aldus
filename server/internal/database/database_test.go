package database

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

func TestMigrationCreatesAndReopensCurrentVersion(t *testing.T) {
	ctx := context.Background()
	path := t.TempDir() + "/aldus.db"
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if version := schemaVersion(t, db); version != 5 {
		t.Fatalf("schema version = %d, want 5", version)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if version := schemaVersion(t, db); version != 5 {
		t.Fatalf("schema version after reopen = %d, want 5", version)
	}
}

func TestMigrationPreservesExistingVersionOne(t *testing.T) {
	ctx := context.Background()
	path := t.TempDir() + "/aldus.db"
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	legacy := initialSchema + `
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

	db, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var segmentText, progressSegment string
	var offset, revision int
	if err := db.QueryRowContext(ctx, `SELECT text FROM alignment_segments WHERE alignment_id='alignment'`).Scan(&segmentText); err != nil || segmentText != "Alice" {
		t.Fatalf("alignment after migration = %q, %v", segmentText, err)
	}
	if err := db.QueryRowContext(ctx, `SELECT segment_id,offset,revision FROM progress WHERE alignment_id='alignment'`).Scan(&progressSegment, &offset, &revision); err != nil || progressSegment != "segment" || offset != 250000 || revision != 1 {
		t.Fatalf("progress after migration = %q %d %d, %v", progressSegment, offset, revision, err)
	}
	var tableCount int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('works','media','koreader_aliases','alignments','alignment_segments','progress')`).Scan(&tableCount); err != nil || tableCount != 6 {
		t.Fatalf("preserved tables = %d, %v", tableCount, err)
	}
	var violation string
	if err := db.QueryRowContext(ctx, `PRAGMA foreign_key_check`).Scan(&violation); err != sql.ErrNoRows {
		t.Fatalf("foreign key check = %q, %v", violation, err)
	}
	if version := schemaVersion(t, db); version != 5 {
		t.Fatalf("migrated schema version = %d, want 5", version)
	}
	var epubHash, representationID string
	if err := db.QueryRowContext(ctx, `SELECT sha256,representation_id FROM media WHERE id='epub'`).Scan(&epubHash, &representationID); err != nil || epubHash != strings.Repeat("a", 64) || representationID != "legacy-representation-epub" {
		t.Fatalf("migrated media = %q %q, %v", epubHash, representationID, err)
	}
	var inputs int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM alignment_inputs WHERE alignment_id='alignment'`).Scan(&inputs); err != nil || inputs != 2 {
		t.Fatalf("alignment inputs = %d, %v", inputs, err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen migrated database: %v", err)
	}
	defer db.Close()
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('users','sessions')`).Scan(&tableCount); err != nil || tableCount != 2 {
		t.Fatalf("authentication tables = %d, %v", tableCount, err)
	}
}

func TestMigrationRejectsNewerDatabase(t *testing.T) {
	path := t.TempDir() + "/aldus.db"
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA user_version = 6`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	_, err = Open(context.Background(), path)
	if err == nil || !strings.Contains(err.Error(), "schema version 6 is newer than supported version 5") {
		t.Fatalf("Open error = %v", err)
	}
}

func TestMigrationFromVersionTwo(t *testing.T) {
	path := t.TempDir() + "/aldus.db"
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(initialSchema + authenticationSchema + `PRAGMA user_version=2; INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','hash',1,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if version := schemaVersion(t, db); version != 5 {
		t.Fatalf("version=%d", version)
	}
	var users, tables int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users); err != nil || users != 1 {
		t.Fatalf("users=%d, %v", users, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('libraries','library_members','representations','alignment_inputs')`).Scan(&tables); err != nil || tables != 4 {
		t.Fatalf("catalog tables=%d, %v", tables, err)
	}
}

func TestMigrationFromVersionThree(t *testing.T) {
	path := t.TempDir() + "/aldus.db"
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(initialSchema + authenticationSchema + catalogSchema + `PRAGMA user_version=3;`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if version := schemaVersion(t, db); version != 5 {
		t.Fatalf("version=%d", version)
	}
	var columns int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('media') WHERE name IN ('original_filename','size_bytes')`).Scan(&columns); err != nil || columns != 2 {
		t.Fatalf("media columns=%d, %v", columns, err)
	}
}

func TestMigrationFromVersionFour(t *testing.T) {
	path := t.TempDir() + "/aldus.db"
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(initialSchema + authenticationSchema + catalogSchema + mediaIngestionSchema + `PRAGMA user_version=4;`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if version := schemaVersion(t, db); version != 5 {
		t.Fatalf("version=%d", version)
	}
	var jobs int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='alignment_jobs'`).Scan(&jobs); err != nil || jobs != 1 {
		t.Fatalf("jobs=%d, %v", jobs, err)
	}
}

func TestMigrationRollsBackFailedVersion(t *testing.T) {
	ctx := context.Background()
	path := t.TempDir() + "/aldus.db"
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	original := migrations
	migrations = append(append([]string{}, migrations...), `CREATE TABLE partial (id TEXT); SELECT nope FROM missing;`)
	t.Cleanup(func() { migrations = original })
	if err := migrate(ctx, db); err == nil {
		t.Fatal("failed migration succeeded")
	}
	if version := schemaVersion(t, db); version != 5 {
		t.Fatalf("schema version after rollback = %d, want 5", version)
	}
	var exists int
	if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'partial')`).Scan(&exists); err != nil || exists != 0 {
		t.Fatalf("partial migration table exists = %d, %v", exists, err)
	}
	db.Close()
}

func schemaVersion(t *testing.T, db *sql.DB) int {
	t.Helper()
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	return version
}
