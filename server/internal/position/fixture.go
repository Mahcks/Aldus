package position

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"
)

const FixtureAlignmentID = "fixture-alignment"

func (s *Store) SeedFixture(ctx context.Context) error {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)
	epubHash := fmt.Sprintf("%x", sha256.Sum256([]byte("aldus deterministic epub fixture revision 1")))
	audioHash := fmt.Sprintf("%x", sha256.Sum256([]byte("aldus deterministic audio fixture revision 1")))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin fixture: %w", err)
	}
	defer tx.Rollback()
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT OR IGNORE INTO libraries (id,name,created_at,updated_at) VALUES ('fixture-library','Fixture Library',?,?)`, []any{now, now}},
		{`INSERT OR IGNORE INTO works (id,library_id,title,created_at,updated_at) VALUES ('fixture-work','fixture-library','Aldus Sync Fixture',?,?)`, []any{now, now}},
		{`INSERT OR IGNORE INTO representations (id,work_id,kind,label,created_at,updated_at) VALUES ('fixture-epub-representation','fixture-work','epub','EPUB',?,?)`, []any{now, now}},
		{`INSERT OR IGNORE INTO representations (id,work_id,kind,label,created_at,updated_at) VALUES ('fixture-audio-representation','fixture-work','audio','Audiobook',?,?)`, []any{now, now}},
		{`INSERT OR IGNORE INTO media (id,representation_id,kind,path,sha256,created_at) VALUES (?,'fixture-epub-representation',?,?,?,?)`, []any{"fixture-epub", "epub", "fixture/book.epub", epubHash, now}},
		{`INSERT OR IGNORE INTO media (id,representation_id,kind,path,sha256,created_at) VALUES (?,'fixture-audio-representation',?,?,?,?)`, []any{"fixture-audio", "audio", "fixture/book.m4b", audioHash, now}},
		{`INSERT OR IGNORE INTO koreader_aliases (document_id, media_id) VALUES ('fixture-koreader-document', 'fixture-epub')`, nil},
		{`INSERT OR IGNORE INTO alignments (id, epub_media_id, audio_media_id, revision, state, created_at) VALUES (?, 'fixture-epub', 'fixture-audio', 1, 'ready', ?)`, []any{FixtureAlignmentID, now}},
		{`INSERT OR IGNORE INTO alignment_inputs (alignment_id,media_id,role) VALUES (?,'fixture-epub','epub')`, []any{FixtureAlignmentID}},
		{`INSERT OR IGNORE INTO alignment_inputs (alignment_id,media_id,role) VALUES (?,'fixture-audio','audio')`, []any{FixtureAlignmentID}},
	}
	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement.query, statement.args...); err != nil {
			return fmt.Errorf("seed fixture: %w", err)
		}
	}
	segments := []struct {
		id, text, href, epub, koreader, resource string
		ordinal                                  int
		start, end                               int64
	}{
		{"s0001", "Resolver test segment one.", "text/chapter-1.xhtml", `{"type":"epubcfi","value":"epubcfi(/6/2!/4/2/1:0)"}`, "/body/DocFragment[1]/body/p[1].0", "fixture/book.m4b", 0, 1000, 2600},
		{"s0002", "Resolver test segment two.", "text/chapter-1.xhtml", `{"type":"epubcfi","value":"epubcfi(/6/2!/4/4/1:0)"}`, "/body/DocFragment[1]/body/p[2].0", "fixture/book.m4b", 1, 2600, 7800},
		{"s0003", "Resolver test segment three.", "text/chapter-1.xhtml", `{"type":"epubcfi","value":"epubcfi(/6/2!/4/6/1:0)"}`, "/body/DocFragment[1]/body/p[3].0", "fixture/book.m4b", 2, 7800, 12100},
	}
	for _, segment := range segments {
		_, err := tx.ExecContext(ctx, `
			INSERT OR IGNORE INTO alignment_segments
			(alignment_id, id, ordinal, text, epub_href, epub_locator, koreader_locator, audio_resource, audio_start_ms, audio_end_ms)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			FixtureAlignmentID, segment.id, segment.ordinal, segment.text, segment.href, segment.epub,
			segment.koreader, segment.resource, segment.start, segment.end)
		if err != nil {
			return fmt.Errorf("seed fixture segment: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit fixture: %w", err)
	}
	return nil
}

// RemoveLegacyFixture deletes scaffold-only data that was previously seeded in production.
func (s *Store) RemoveLegacyFixture(ctx context.Context) error {
	var exists bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM works WHERE id = 'fixture-work')`).Scan(&exists); err != nil {
		return fmt.Errorf("find legacy fixture: %w", err)
	}
	if !exists {
		if _, err := s.db.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
			return fmt.Errorf("checkpoint database: %w", err)
		}
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin legacy fixture removal: %w", err)
	}
	defer tx.Rollback()
	for _, query := range []string{
		`DELETE FROM progress WHERE alignment_id = 'fixture-alignment'`,
		`DELETE FROM alignment_segments WHERE alignment_id = 'fixture-alignment'`,
		`DELETE FROM alignment_inputs WHERE alignment_id = 'fixture-alignment'`,
		`DELETE FROM alignments WHERE id = 'fixture-alignment'`,
		`DELETE FROM koreader_aliases WHERE media_id IN ('fixture-epub', 'fixture-audio')`,
		`DELETE FROM media WHERE representation_id IN ('fixture-epub-representation','fixture-audio-representation')`,
		`DELETE FROM representations WHERE work_id = 'fixture-work'`,
		`DELETE FROM works WHERE id = 'fixture-work'`,
		`DELETE FROM libraries WHERE id = 'fixture-library'`,
	} {
		if _, err := tx.ExecContext(ctx, query); err != nil {
			return fmt.Errorf("remove legacy fixture: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit legacy fixture removal: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `VACUUM`); err != nil {
		return fmt.Errorf("compact legacy fixture data: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		return fmt.Errorf("checkpoint legacy fixture removal: %w", err)
	}
	return nil
}
