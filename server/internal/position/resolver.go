package position

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

func (s *Store) EPUBToCanonical(ctx context.Context, alignmentID string, locator EPUBLocator) (Canonical, error) {
	if !json.Valid(locator.Locator) || locator.Offset < 0 || locator.Offset > OffsetMax {
		return Canonical{}, ErrInvalid
	}
	var p Canonical
	err := s.db.QueryRowContext(ctx, `
		SELECT s.alignment_id, s.id
		FROM alignment_segments s JOIN alignments a ON a.id = s.alignment_id
		WHERE s.alignment_id = ? AND s.epub_href = ? AND s.epub_locator = ? AND a.state = 'ready'`,
		alignmentID, locator.Href, string(locator.Locator),
	).Scan(&p.AlignmentID, &p.SegmentID)
	if errors.Is(err, sql.ErrNoRows) {
		return Canonical{}, ErrNotFound
	}
	if err != nil {
		return Canonical{}, fmt.Errorf("resolve EPUB locator: %w", err)
	}
	p.Offset = locator.Offset
	return p, nil
}

func (s *Store) CanonicalToEPUB(ctx context.Context, p Canonical) (EPUBLocator, error) {
	if p.Offset < 0 || p.Offset > OffsetMax {
		return EPUBLocator{}, ErrInvalid
	}
	var locator EPUBLocator
	var raw string
	err := s.db.QueryRowContext(ctx, `
		SELECT s.epub_href, s.epub_locator
		FROM alignment_segments s JOIN alignments a ON a.id = s.alignment_id
		WHERE s.alignment_id = ? AND s.id = ? AND a.state = 'ready'`,
		p.AlignmentID, p.SegmentID,
	).Scan(&locator.Href, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return EPUBLocator{}, ErrNotFound
	}
	if err != nil {
		return EPUBLocator{}, fmt.Errorf("resolve canonical EPUB locator: %w", err)
	}
	locator.Locator = json.RawMessage(raw)
	locator.Offset = p.Offset
	return locator, nil
}

func (s *Store) AudioToCanonical(ctx context.Context, alignmentID string, locator AudioLocator) (Canonical, error) {
	var p Canonical
	var start, end int64
	err := s.db.QueryRowContext(ctx, `
		SELECT s.alignment_id, s.id, s.audio_start_ms, s.audio_end_ms
		FROM alignment_segments s JOIN alignments a ON a.id = s.alignment_id
		WHERE s.alignment_id = ? AND s.audio_resource = ?
			AND s.audio_start_ms <= ? AND s.audio_end_ms > ? AND a.state = 'ready'
		ORDER BY s.ordinal LIMIT 1`,
		alignmentID, locator.Resource, locator.TimestampMS, locator.TimestampMS,
	).Scan(&p.AlignmentID, &p.SegmentID, &start, &end)
	if errors.Is(err, sql.ErrNoRows) {
		return Canonical{}, ErrNotFound
	}
	if err != nil {
		return Canonical{}, fmt.Errorf("resolve audio locator: %w", err)
	}
	p.Offset = int((locator.TimestampMS - start) * OffsetMax / (end - start))
	return p, nil
}

func (s *Store) CanonicalToAudio(ctx context.Context, p Canonical) (AudioLocator, error) {
	if p.Offset < 0 || p.Offset > OffsetMax {
		return AudioLocator{}, ErrInvalid
	}
	var locator AudioLocator
	var start, end int64
	err := s.db.QueryRowContext(ctx, `
		SELECT s.audio_resource, s.audio_start_ms, s.audio_end_ms
		FROM alignment_segments s JOIN alignments a ON a.id = s.alignment_id
		WHERE s.alignment_id = ? AND s.id = ? AND a.state = 'ready'`,
		p.AlignmentID, p.SegmentID,
	).Scan(&locator.Resource, &start, &end)
	if errors.Is(err, sql.ErrNoRows) {
		return AudioLocator{}, ErrNotFound
	}
	if err != nil {
		return AudioLocator{}, fmt.Errorf("resolve canonical audio locator: %w", err)
	}
	locator.TimestampMS = start + int64(p.Offset)*(end-start)/OffsetMax
	return locator, nil
}

func (s *Store) KOReaderToCanonical(ctx context.Context, locator KOReaderLocator) (Canonical, error) {
	var p Canonical
	err := s.db.QueryRowContext(ctx, `
		SELECT s.alignment_id, s.id
		FROM koreader_aliases k
		JOIN alignments a ON a.epub_media_id = k.media_id AND a.state = 'ready'
		JOIN alignment_segments s ON s.alignment_id = a.id AND s.koreader_locator = ?
		WHERE k.document_id = ?`, locator.Progress, locator.DocumentID,
	).Scan(&p.AlignmentID, &p.SegmentID)
	if errors.Is(err, sql.ErrNoRows) {
		return Canonical{}, ErrNotFound
	}
	if err != nil {
		return Canonical{}, fmt.Errorf("resolve KOReader locator: %w", err)
	}
	return p, nil
}

func (s *Store) AlignmentForKOReaderDocument(ctx context.Context, documentID string) (string, error) {
	var alignmentID string
	err := s.db.QueryRowContext(ctx, `
		SELECT a.id FROM koreader_aliases k
		JOIN alignments a ON a.epub_media_id = k.media_id AND a.state = 'ready'
		WHERE k.document_id = ?`, documentID,
	).Scan(&alignmentID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("resolve KOReader document: %w", err)
	}
	return alignmentID, nil
}

func (s *Store) CanonicalToKOReader(ctx context.Context, p Canonical) (KOReaderLocator, error) {
	var locator KOReaderLocator
	var ordinal, total int
	err := s.db.QueryRowContext(ctx, `
		SELECT k.document_id, s.koreader_locator, s.ordinal,
			(SELECT COUNT(*) FROM alignment_segments WHERE alignment_id = s.alignment_id)
		FROM alignment_segments s
		JOIN alignments a ON a.id = s.alignment_id AND a.state = 'ready'
		JOIN koreader_aliases k ON k.media_id = a.epub_media_id
		WHERE s.alignment_id = ? AND s.id = ?`, p.AlignmentID, p.SegmentID,
	).Scan(&locator.DocumentID, &locator.Progress, &ordinal, &total)
	if errors.Is(err, sql.ErrNoRows) {
		return KOReaderLocator{}, ErrNotFound
	}
	if err != nil {
		return KOReaderLocator{}, fmt.Errorf("resolve canonical KOReader locator: %w", err)
	}
	locator.Percentage = (float64(ordinal) + float64(p.Offset)/OffsetMax) / float64(total)
	return locator, nil
}
