package position

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	dbsql "github.com/mahcks/aldus/server/internal/database/sqlc"
)

type Store struct {
	db      *sql.DB
	queries *dbsql.Queries
}

func New(db *sql.DB) *Store { return &Store{db: db, queries: dbsql.New(db)} }

func (s *Store) WorkForAlignment(ctx context.Context, alignmentID string) (string, error) {
	workID, err := s.queries.WorkForAlignment(ctx, alignmentID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return workID, err
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
			audio_resource, audio_start_ms, audio_end_ms, highlightable, alignment_status,
			COALESCE(word_timings, '')
		FROM alignment_segments WHERE alignment_id = ? ORDER BY ordinal`, alignmentID)
	if err != nil {
		return Alignment{}, fmt.Errorf("get alignment segments: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var segment Segment
		var epubLocator, wordTimings string
		if err := rows.Scan(&segment.ID, &segment.Ordinal, &segment.Text, &segment.EPUBHref, &epubLocator,
			&segment.KOReaderLocator, &segment.AudioResource, &segment.AudioStartMS, &segment.AudioEndMS, &segment.Highlightable, &segment.AlignmentStatus, &wordTimings); err != nil {
			return Alignment{}, fmt.Errorf("scan alignment segment: %w", err)
		}
		segment.EPUBLocator = []byte(epubLocator)
		if json.Valid([]byte(wordTimings)) {
			segment.WordTimings = []byte(wordTimings)
		}
		alignment.Segments = append(alignment.Segments, segment)
	}
	if err := rows.Err(); err != nil {
		return Alignment{}, fmt.Errorf("read alignment segments: %w", err)
	}
	return alignment, nil
}

func (s *Store) Progress(ctx context.Context, userID, workID string) (Canonical, error) {
	row, err := s.queries.GetProgress(ctx, dbsql.GetProgressParams{UserID: userID, WorkID: workID})
	return progressRow(row, err)
}

func progressRow(row dbsql.GetProgressRow, err error) (Canonical, error) {
	if errors.Is(err, sql.ErrNoRows) {
		return Canonical{}, ErrNotFound
	}
	if err != nil {
		return Canonical{}, fmt.Errorf("get progress: %w", err)
	}
	p := Canonical{
		WorkID: row.WorkID, AlignmentID: row.AlignmentID, SegmentID: row.SegmentID,
		Offset: int(row.Offset), Revision: row.Revision, SourceDevice: row.SourceDevice,
		AlignmentState: row.AlignmentState,
	}
	p.UpdatedAt, err = time.Parse(time.RFC3339Nano, row.UpdatedAt)
	if err != nil {
		return Canonical{}, fmt.Errorf("parse progress time: %w", err)
	}
	value := row.Resolvable.Bool
	p.Resolvable = &value
	return p, nil
}

func (s *Store) UpdateProgress(ctx context.Context, userID, workID, alignmentID string, update Update) (Canonical, error) {
	if update.Offset < 0 || update.Offset > OffsetMax || update.SourceDevice == "" {
		return Canonical{}, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Canonical{}, fmt.Errorf("begin progress update: %w", err)
	}
	defer tx.Rollback()
	queries := s.queries.WithTx(tx)

	var validWork string
	if err := tx.QueryRowContext(ctx, `
		SELECT w.id FROM alignment_segments s
		JOIN alignments a ON a.id=s.alignment_id AND a.state='ready'
		JOIN media m ON m.id=a.epub_media_id JOIN representations r ON r.id=m.representation_id
		JOIN works w ON w.id=r.work_id
		WHERE s.alignment_id=? AND s.id=? AND s.highlightable=1 AND w.id=?
		AND EXISTS (SELECT 1 FROM alignment_inputs WHERE alignment_id=a.id)
		AND NOT EXISTS (
			SELECT 1 FROM alignment_inputs ai
			JOIN media input_media ON input_media.id=ai.media_id
			JOIN representations input_representation ON input_representation.id=input_media.representation_id
			WHERE ai.alignment_id=a.id AND input_representation.work_id<>w.id
		)`, alignmentID, update.SegmentID, workID).Scan(&validWork); errors.Is(err, sql.ErrNoRows) {
		return Canonical{}, ErrNotFound
	} else if err != nil {
		return Canonical{}, fmt.Errorf("validate progress segment: %w", err)
	}

	var currentRevision int64
	currentRevision, err = queries.GetProgressRevision(ctx, dbsql.GetProgressRevisionParams{UserID: userID, WorkID: workID})
	if errors.Is(err, sql.ErrNoRows) {
		currentRevision = 0
	} else if err != nil {
		return Canonical{}, fmt.Errorf("get progress revision: %w", err)
	}
	if update.ExpectedRevision != currentRevision {
		current, getErr := progressTx(ctx, queries, userID, workID)
		if getErr != nil {
			return Canonical{}, ErrConflict
		}
		return current, ErrConflict
	}

	p := Canonical{
		WorkID:         workID,
		AlignmentID:    alignmentID,
		SegmentID:      update.SegmentID,
		Offset:         update.Offset,
		Revision:       currentRevision + 1,
		UpdatedAt:      time.Now().UTC(),
		SourceDevice:   update.SourceDevice,
		AlignmentState: "ready",
	}
	resolvable := true
	p.Resolvable = &resolvable
	err = queries.UpsertProgress(ctx, dbsql.UpsertProgressParams{
		UserID: userID, WorkID: p.WorkID, AlignmentID: p.AlignmentID, SegmentID: p.SegmentID,
		Offset: int64(p.Offset), Revision: p.Revision, UpdatedAt: p.UpdatedAt.Format(time.RFC3339Nano), SourceDevice: p.SourceDevice,
	})
	if err != nil {
		return Canonical{}, fmt.Errorf("save progress: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Canonical{}, fmt.Errorf("commit progress update: %w", err)
	}
	return p, nil
}

func progressTx(ctx context.Context, queries *dbsql.Queries, userID, workID string) (Canonical, error) {
	row, err := queries.GetProgress(ctx, dbsql.GetProgressParams{UserID: userID, WorkID: workID})
	return progressRow(row, err)
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
