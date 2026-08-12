package position

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

type Store struct {
	db *sql.DB
}

func Open(ctx context.Context, path string) (*Store, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve SQLite path: %w", err)
	}
	dsn := (&url.URL{Scheme: "file", Path: path, RawQuery: "_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open SQLite: %w", err)
	}
	// ponytail: one connection makes transaction behavior deterministic; raise only if measured read contention warrants it.
	db.SetMaxOpenConns(1)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping SQLite: %w", err)
	}
	if _, err := db.ExecContext(ctx, `PRAGMA journal_mode = WAL`); err != nil {
		db.Close()
		return nil, fmt.Errorf("enable SQLite WAL: %w", err)
	}
	if err := migrate(ctx, db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate SQLite: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Alignment(ctx context.Context, alignmentID string) (Alignment, error) {
	var alignment Alignment
	err := s.db.QueryRowContext(ctx, `
		SELECT a.id, a.revision, a.state, epub.sha256, audio.sha256
		FROM alignments a
		JOIN media epub ON epub.id = a.epub_media_id
		JOIN media audio ON audio.id = a.audio_media_id
		WHERE a.id = ?`, alignmentID,
	).Scan(&alignment.ID, &alignment.Revision, &alignment.State, &alignment.EPUBSHA256, &alignment.AudioSHA256)
	if errors.Is(err, sql.ErrNoRows) {
		return Alignment{}, ErrNotFound
	}
	if err != nil {
		return Alignment{}, fmt.Errorf("get alignment: %w", err)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, ordinal, text, epub_href, epub_locator, koreader_locator,
			audio_resource, audio_start_ms, audio_end_ms
		FROM alignment_segments WHERE alignment_id = ? ORDER BY ordinal`, alignmentID)
	if err != nil {
		return Alignment{}, fmt.Errorf("get alignment segments: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var segment Segment
		var epubLocator string
		if err := rows.Scan(&segment.ID, &segment.Ordinal, &segment.Text, &segment.EPUBHref, &epubLocator,
			&segment.KOReaderLocator, &segment.AudioResource, &segment.AudioStartMS, &segment.AudioEndMS); err != nil {
			return Alignment{}, fmt.Errorf("scan alignment segment: %w", err)
		}
		segment.EPUBLocator = []byte(epubLocator)
		alignment.Segments = append(alignment.Segments, segment)
	}
	if err := rows.Err(); err != nil {
		return Alignment{}, fmt.Errorf("read alignment segments: %w", err)
	}
	return alignment, nil
}

func (s *Store) Progress(ctx context.Context, alignmentID string) (Canonical, error) {
	var p Canonical
	var updatedAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT alignment_id, segment_id, offset, revision, updated_at, source_device
		FROM progress WHERE alignment_id = ?`, alignmentID,
	).Scan(&p.AlignmentID, &p.SegmentID, &p.Offset, &p.Revision, &updatedAt, &p.SourceDevice)
	if errors.Is(err, sql.ErrNoRows) {
		return Canonical{}, ErrNotFound
	}
	if err != nil {
		return Canonical{}, fmt.Errorf("get progress: %w", err)
	}
	p.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return Canonical{}, fmt.Errorf("parse progress time: %w", err)
	}
	return p, nil
}

func (s *Store) UpdateProgress(ctx context.Context, alignmentID string, update Update) (Canonical, error) {
	if update.Offset < 0 || update.Offset > OffsetMax || update.SourceDevice == "" {
		return Canonical{}, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Canonical{}, fmt.Errorf("begin progress update: %w", err)
	}
	defer tx.Rollback()

	var exists int
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM alignment_segments s
			JOIN alignments a ON a.id = s.alignment_id
			WHERE s.alignment_id = ? AND s.id = ? AND a.state = 'ready'
		)`, alignmentID, update.SegmentID).Scan(&exists); err != nil {
		return Canonical{}, fmt.Errorf("validate progress segment: %w", err)
	}
	if exists == 0 {
		return Canonical{}, ErrNotFound
	}

	var currentRevision int64
	err = tx.QueryRowContext(ctx, `SELECT revision FROM progress WHERE alignment_id = ?`, alignmentID).Scan(&currentRevision)
	if errors.Is(err, sql.ErrNoRows) {
		currentRevision = 0
	} else if err != nil {
		return Canonical{}, fmt.Errorf("get progress revision: %w", err)
	}
	if update.ExpectedRevision != currentRevision {
		current, getErr := progressTx(ctx, tx, alignmentID)
		if getErr != nil {
			return Canonical{}, ErrConflict
		}
		return current, ErrConflict
	}

	p := Canonical{
		AlignmentID:  alignmentID,
		SegmentID:    update.SegmentID,
		Offset:       update.Offset,
		Revision:     currentRevision + 1,
		UpdatedAt:    time.Now().UTC(),
		SourceDevice: update.SourceDevice,
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO progress (alignment_id, segment_id, offset, revision, updated_at, source_device)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(alignment_id) DO UPDATE SET
			segment_id = excluded.segment_id,
			offset = excluded.offset,
			revision = excluded.revision,
			updated_at = excluded.updated_at,
			source_device = excluded.source_device`,
		p.AlignmentID, p.SegmentID, p.Offset, p.Revision, p.UpdatedAt.Format(time.RFC3339Nano), p.SourceDevice)
	if err != nil {
		return Canonical{}, fmt.Errorf("save progress: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Canonical{}, fmt.Errorf("commit progress update: %w", err)
	}
	return p, nil
}

func progressTx(ctx context.Context, tx *sql.Tx, alignmentID string) (Canonical, error) {
	var p Canonical
	var updatedAt string
	err := tx.QueryRowContext(ctx, `
		SELECT alignment_id, segment_id, offset, revision, updated_at, source_device
		FROM progress WHERE alignment_id = ?`, alignmentID,
	).Scan(&p.AlignmentID, &p.SegmentID, &p.Offset, &p.Revision, &updatedAt, &p.SourceDevice)
	if err != nil {
		return Canonical{}, err
	}
	p.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
	return p, err
}

func (s *Store) Ordinal(ctx context.Context, p Canonical) (int, error) {
	var ordinal int
	err := s.db.QueryRowContext(ctx, `
		SELECT ordinal FROM alignment_segments WHERE alignment_id = ? AND id = ?`,
		p.AlignmentID, p.SegmentID,
	).Scan(&ordinal)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("get segment ordinal: %w", err)
	}
	return ordinal, nil
}
