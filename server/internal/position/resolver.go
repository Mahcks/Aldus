package position

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

func (s *Store) EPUBToCanonical(ctx context.Context, alignmentID string, locator EPUBLocator) (Canonical, error) {
	if !json.Valid(locator.Locator) || locator.Offset < 0 || locator.Offset > OffsetMax {
		return Canonical{}, ErrInvalid
	}
	var p Canonical
	err := s.db.QueryRowContext(ctx, `
		SELECT s.alignment_id, s.id
		FROM alignment_segments s JOIN alignments a ON a.id = s.alignment_id
		WHERE s.alignment_id = ? AND s.epub_href = ?
			AND ((json_extract(?,'$.segment_id') IS NOT NULL
				AND s.id=json_extract(?,'$.segment_id')
				AND json_extract(s.epub_locator,'$.dom_path')=json_extract(?,'$.dom_path')) OR
			(json_extract(?,'$.segment_id') IS NULL AND (s.epub_locator=? OR (
				json_extract(s.epub_locator,'$.type')=json_extract(?,'$.type')
				AND json_extract(s.epub_locator,'$.dom_path')=json_extract(?,'$.dom_path')))))
			AND s.highlightable=1 AND a.state = 'ready'
		ORDER BY s.ordinal LIMIT 1`,
		alignmentID, locator.Href, string(locator.Locator), string(locator.Locator), string(locator.Locator), string(locator.Locator), string(locator.Locator), string(locator.Locator), string(locator.Locator),
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
		WHERE s.alignment_id = ? AND s.id = ? AND s.highlightable=1 AND a.state = 'ready'`,
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
	var text string
	var timings sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT s.alignment_id, s.id, s.audio_start_ms, s.audio_end_ms, s.text, s.word_timings
		FROM alignment_segments s JOIN alignments a ON a.id = s.alignment_id
		WHERE s.alignment_id = ? AND s.audio_resource = ?
			AND s.audio_start_ms <= ? AND s.audio_end_ms > ? AND s.highlightable=1 AND a.state = 'ready'
		ORDER BY s.ordinal LIMIT 1`,
		alignmentID, locator.Resource, locator.TimestampMS, locator.TimestampMS,
	).Scan(&p.AlignmentID, &p.SegmentID, &start, &end, &text, &timings)
	if errors.Is(err, sql.ErrNoRows) {
		return Canonical{}, ErrNotFound
	}
	if err != nil {
		return Canonical{}, fmt.Errorf("resolve audio locator: %w", err)
	}
	if offset, ok := wordOffset(locator.TimestampMS, text, timings.String); timings.Valid && ok {
		p.Offset = offset
	} else {
		p.Offset = int((locator.TimestampMS - start) * OffsetMax / (end - start))
	}
	return p, nil
}

func (s *Store) CanonicalToAudio(ctx context.Context, p Canonical) (AudioLocator, error) {
	if p.Offset < 0 || p.Offset > OffsetMax {
		return AudioLocator{}, ErrInvalid
	}
	var locator AudioLocator
	var start, end int64
	var text string
	var timings sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT s.audio_resource, s.audio_start_ms, s.audio_end_ms, s.text, s.word_timings
		FROM alignment_segments s JOIN alignments a ON a.id = s.alignment_id
		WHERE s.alignment_id = ? AND s.id = ? AND s.highlightable=1 AND a.state = 'ready'`,
		p.AlignmentID, p.SegmentID,
	).Scan(&locator.Resource, &start, &end, &text, &timings)
	if errors.Is(err, sql.ErrNoRows) {
		return AudioLocator{}, ErrNotFound
	}
	if err != nil {
		return AudioLocator{}, fmt.Errorf("resolve canonical audio locator: %w", err)
	}
	if timestamp, ok := wordTimestamp(p.Offset, text, timings.String); timings.Valid && ok && timestamp >= start && timestamp <= end {
		locator.TimestampMS = timestamp
	} else {
		locator.TimestampMS = start + int64(p.Offset)*(end-start)/OffsetMax
	}
	return locator, nil
}

type timedWord struct {
	Text      string  `json:"text"`
	StartTime float64 `json:"startTime"`
	EndTime   float64 `json:"endTime"`
}

func timedWords(raw string) ([]timedWord, bool) {
	var words []timedWord
	if json.Unmarshal([]byte(raw), &words) != nil || len(words) == 0 {
		return nil, false
	}
	for _, word := range words {
		if word.Text == "" || word.StartTime <= 0 || word.EndTime < word.StartTime {
			return nil, false
		}
	}
	return words, true
}

func wordTimestamp(offset int, text, raw string) (int64, bool) {
	words, ok := timedWords(raw)
	if !ok {
		return 0, false
	}
	normalized := normalizeText(text)
	textWords := strings.Fields(normalized)
	if len(textWords) == 0 {
		return 0, false
	}
	total := len([]rune(normalized))
	position := offset * total / OffsetMax
	cursor := 0
	for index, word := range textWords {
		end := cursor + len([]rune(word))
		if position < end {
			if index >= len(words) {
				return int64(words[len(words)-1].StartTime * 1000), true
			}
			return int64(words[index].StartTime * 1000), true
		}
		cursor = end + 1
	}
	return int64(words[len(words)-1].StartTime * 1000), true
}

func wordOffset(timestamp int64, text, raw string) (int, bool) {
	words, ok := timedWords(raw)
	if !ok {
		return 0, false
	}
	normalized := normalizeText(text)
	textWords := strings.Fields(normalized)
	if len(textWords) == 0 {
		return 0, false
	}
	index := len(words) - 1
	for candidate, word := range words {
		if timestamp <= int64(word.EndTime*1000) {
			index = candidate
			break
		}
	}
	if index >= len(textWords) {
		index = len(textWords) - 1
	}
	cursor := len([]rune(strings.Join(textWords[:index], " ")))
	if index > 0 {
		cursor++
	}
	return cursor * OffsetMax / len([]rune(normalized)), true
}

func normalizeText(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

func (s *Store) KOReaderToCanonical(ctx context.Context, locator KOReaderLocator) (Canonical, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.alignment_id, s.id, s.koreader_locator
		FROM koreader_aliases k
		JOIN alignments a ON a.epub_media_id = k.media_id AND a.state = 'ready'
		JOIN alignment_segments s ON s.alignment_id = a.id
		WHERE k.document_id = ? AND s.highlightable = 1 ORDER BY s.ordinal`, locator.DocumentID)
	if err != nil {
		return Canonical{}, fmt.Errorf("resolve KOReader locator: %w", err)
	}
	defer rows.Close()
	structuralFragment, structural := koReaderStructuralStart(locator.Progress)
	var structuralFallback Canonical
	for rows.Next() {
		var p Canonical
		var raw string
		if err := rows.Scan(&p.AlignmentID, &p.SegmentID, &raw); err != nil {
			return Canonical{}, fmt.Errorf("resolve KOReader locator: %w", err)
		}
		if raw == locator.Progress {
			return p, nil
		}
		if structural && structuralFallback.SegmentID == "" && koReaderParagraphFragment(raw) == structuralFragment {
			structuralFallback = p
		}
		if p.Offset, err = koReaderToCanonical(raw, locator.Progress); err == nil {
			return p, nil
		}
	}
	if err := rows.Err(); err != nil {
		return Canonical{}, fmt.Errorf("resolve KOReader locator: %w", err)
	}
	if structuralFallback.SegmentID != "" {
		return structuralFallback, nil
	}
	return Canonical{}, ErrNotFound
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

func (s *Store) KOReaderOwner(ctx context.Context, username, documentID string) (userID, workID, alignmentID string, err error) {
	err = s.db.QueryRowContext(ctx, `SELECT u.id,w.id,a.id FROM users u CROSS JOIN works w JOIN representations r ON r.work_id=w.id JOIN media m ON m.representation_id=r.id JOIN koreader_aliases k ON k.media_id=m.id JOIN alignments a ON a.epub_media_id=m.id WHERE u.username_normalized=lower(trim(?)) AND u.disabled=0 AND (EXISTS(SELECT 1 FROM library_members exclusive_grant WHERE exclusive_grant.user_id=u.id AND exclusive_grant.library_id=w.library_id AND exclusive_grant.exclusive=1) OR (NOT EXISTS(SELECT 1 FROM library_members exclusive_override WHERE exclusive_override.user_id=u.id AND exclusive_override.exclusive=1) AND (u.is_admin=1 OR EXISTS(SELECT 1 FROM library_members additive_grant WHERE additive_grant.user_id=u.id AND additive_grant.library_id=w.library_id)))) AND k.document_id=? AND a.state='ready'`, username, documentID).Scan(&userID, &workID, &alignmentID)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return
}

func (s *Store) CanonicalToKOReader(ctx context.Context, p Canonical) (KOReaderLocator, error) {
	var locator KOReaderLocator
	var raw string
	var ordinal, total int
	err := s.db.QueryRowContext(ctx, `
		SELECT k.document_id, s.koreader_locator, s.ordinal,
			(SELECT COUNT(*) FROM alignment_segments WHERE alignment_id = s.alignment_id)
		FROM alignment_segments s
		JOIN alignments a ON a.id = s.alignment_id AND a.state = 'ready'
		JOIN koreader_aliases k ON k.media_id = a.epub_media_id
		WHERE s.alignment_id = ? AND s.id = ?`, p.AlignmentID, p.SegmentID,
	).Scan(&locator.DocumentID, &raw, &ordinal, &total)
	if errors.Is(err, sql.ErrNoRows) {
		return KOReaderLocator{}, ErrNotFound
	}
	if err != nil {
		return KOReaderLocator{}, fmt.Errorf("resolve canonical KOReader locator: %w", err)
	}
	if strings.HasPrefix(raw, "{") {
		locator.Progress, err = canonicalToKOReader(raw, p.Offset)
		if err != nil {
			return KOReaderLocator{}, err
		}
	} else if !strings.HasPrefix(raw, "unavailable:") {
		locator.Progress = raw
	} else {
		return KOReaderLocator{}, ErrNotFound
	}
	locator.Percentage = (float64(ordinal) + float64(p.Offset)/OffsetMax) / float64(total)
	return locator, nil
}
