package position

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type Store struct {
	db *sql.DB
}

type scanner interface{ Scan(...any) error }

func New(db *sql.DB) *Store { return &Store{db: db} }

func (s *Store) WorkForAlignment(ctx context.Context, alignmentID string) (string, error) {
	var workID string
	err := s.db.QueryRowContext(ctx, `SELECT r.work_id FROM alignments a JOIN media m ON m.id=a.epub_media_id JOIN representations r ON r.id=m.representation_id WHERE a.id=?`, alignmentID).Scan(&workID)
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

func (s *Store) Progress(ctx context.Context, userID, workID string) (Canonical, error) {
	return progressRow(s.db.QueryRowContext(ctx, `
		SELECT p.work_id,p.alignment_id,p.segment_id,p.offset,p.revision,p.updated_at,p.source_device,a.state,
			a.state='ready' AND seg.highlightable=1
		FROM progress p JOIN alignments a ON a.id=p.alignment_id
		JOIN alignment_segments seg ON seg.alignment_id=p.alignment_id AND seg.id=p.segment_id
		WHERE p.user_id=? AND p.work_id=?`, userID, workID))
}

func progressRow(row scanner) (Canonical, error) {
	var p Canonical
	var updatedAt string
	var resolvable int
	err := row.Scan(&p.WorkID, &p.AlignmentID, &p.SegmentID, &p.Offset, &p.Revision, &updatedAt, &p.SourceDevice, &p.AlignmentState, &resolvable)
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
	value := resolvable != 0
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
	err = tx.QueryRowContext(ctx, `SELECT revision FROM progress WHERE user_id=? AND work_id=?`, userID, workID).Scan(&currentRevision)
	if errors.Is(err, sql.ErrNoRows) {
		currentRevision = 0
	} else if err != nil {
		return Canonical{}, fmt.Errorf("get progress revision: %w", err)
	}
	if update.ExpectedRevision != currentRevision {
		current, getErr := progressTx(ctx, tx, userID, workID)
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
	_, err = tx.ExecContext(ctx, `
		INSERT INTO progress (user_id,work_id,alignment_id,segment_id,offset,revision,updated_at,source_device)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id,work_id) DO UPDATE SET
			alignment_id = excluded.alignment_id,
			segment_id = excluded.segment_id,
			offset = excluded.offset,
			revision = excluded.revision,
			updated_at = excluded.updated_at,
			source_device = excluded.source_device`,
		userID, p.WorkID, p.AlignmentID, p.SegmentID, p.Offset, p.Revision, p.UpdatedAt.Format(time.RFC3339Nano), p.SourceDevice)
	if err != nil {
		return Canonical{}, fmt.Errorf("save progress: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Canonical{}, fmt.Errorf("commit progress update: %w", err)
	}
	return p, nil
}

func progressTx(ctx context.Context, tx *sql.Tx, userID, workID string) (Canonical, error) {
	return progressRow(tx.QueryRowContext(ctx, `SELECT p.work_id,p.alignment_id,p.segment_id,p.offset,p.revision,p.updated_at,p.source_device,a.state,a.state='ready' AND s.highlightable=1 FROM progress p JOIN alignments a ON a.id=p.alignment_id JOIN alignment_segments s ON s.alignment_id=p.alignment_id AND s.id=p.segment_id WHERE p.user_id=? AND p.work_id=?`, userID, workID))
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
