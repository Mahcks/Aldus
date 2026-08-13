package position

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"
)

func (s *Store) RepresentationState(ctx context.Context, userID, representationID string) (RepresentationState, error) {
	return representationStateRow(s.db.QueryRowContext(ctx, `SELECT representation_id,epub_locator,audio_timestamp_ms,playback_speed_milli,reader_layout,zoom_milli,revision,updated_at FROM representation_state WHERE user_id=? AND representation_id=?`, userID, representationID))
}

func (s *Store) UpdateRepresentationState(ctx context.Context, userID, representationID string, update RepresentationUpdate) (RepresentationState, error) {
	if !validRepresentationUpdate(update) {
		return RepresentationState{}, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return RepresentationState{}, fmt.Errorf("begin representation-state update: %w", err)
	}
	defer tx.Rollback()
	var currentRevision int64
	err = tx.QueryRowContext(ctx, `SELECT revision FROM representation_state WHERE user_id=? AND representation_id=?`, userID, representationID).Scan(&currentRevision)
	if errors.Is(err, sql.ErrNoRows) {
		currentRevision = 0
	} else if err != nil {
		return RepresentationState{}, fmt.Errorf("get representation-state revision: %w", err)
	}
	if currentRevision != update.ExpectedRevision {
		current, currentErr := representationStateRow(tx.QueryRowContext(ctx, `SELECT representation_id,epub_locator,audio_timestamp_ms,playback_speed_milli,reader_layout,zoom_milli,revision,updated_at FROM representation_state WHERE user_id=? AND representation_id=?`, userID, representationID))
		if currentErr != nil {
			return RepresentationState{}, ErrConflict
		}
		return current, ErrConflict
	}
	now := time.Now().UTC()
	var epub any
	if len(update.EPUBLocator) > 0 {
		epub = string(update.EPUBLocator)
	}
	var speed, zoom any
	if update.PlaybackSpeed != nil {
		speed = int(math.Round(*update.PlaybackSpeed * 1000))
	}
	if update.Zoom != nil {
		zoom = int(math.Round(*update.Zoom * 1000))
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO representation_state(user_id,representation_id,epub_locator,audio_timestamp_ms,playback_speed_milli,reader_layout,zoom_milli,revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,representation_id) DO UPDATE SET epub_locator=excluded.epub_locator,audio_timestamp_ms=excluded.audio_timestamp_ms,playback_speed_milli=excluded.playback_speed_milli,reader_layout=excluded.reader_layout,zoom_milli=excluded.zoom_milli,revision=excluded.revision,updated_at=excluded.updated_at`, userID, representationID, epub, update.AudioTimestampMS, speed, nullString(update.ReaderLayout), zoom, currentRevision+1, now.Format(time.RFC3339Nano))
	if err != nil {
		return RepresentationState{}, fmt.Errorf("save representation state: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return RepresentationState{}, fmt.Errorf("commit representation state: %w", err)
	}
	return s.RepresentationState(ctx, userID, representationID)
}

func validRepresentationUpdate(update RepresentationUpdate) bool {
	if len(update.EPUBLocator) > 0 && !json.Valid(update.EPUBLocator) || update.AudioTimestampMS != nil && *update.AudioTimestampMS < 0 || update.PlaybackSpeed != nil && (*update.PlaybackSpeed < .25 || *update.PlaybackSpeed > 4) || update.Zoom != nil && (*update.Zoom < .5 || *update.Zoom > 3) || update.ReaderLayout != "" && update.ReaderLayout != "paginated" && update.ReaderLayout != "scrolled" {
		return false
	}
	return len(update.EPUBLocator) > 0 || update.AudioTimestampMS != nil || update.PlaybackSpeed != nil || update.Zoom != nil || update.ReaderLayout != ""
}

func representationStateRow(row scanner) (RepresentationState, error) {
	var state RepresentationState
	var epub, layout sql.NullString
	var audio, speed, zoom sql.NullInt64
	var updated string
	if err := row.Scan(&state.RepresentationID, &epub, &audio, &speed, &layout, &zoom, &state.Revision, &updated); errors.Is(err, sql.ErrNoRows) {
		return RepresentationState{}, ErrNotFound
	} else if err != nil {
		return RepresentationState{}, err
	}
	if epub.Valid {
		state.EPUBLocator = json.RawMessage(epub.String)
	}
	if audio.Valid {
		value := audio.Int64
		state.AudioTimestampMS = &value
	}
	if speed.Valid {
		value := float64(speed.Int64) / 1000
		state.PlaybackSpeed = &value
	}
	if zoom.Valid {
		value := float64(zoom.Int64) / 1000
		state.Zoom = &value
	}
	state.ReaderLayout = layout.String
	var err error
	state.UpdatedAt, err = time.Parse(time.RFC3339Nano, updated)
	if err != nil {
		return RepresentationState{}, fmt.Errorf("parse representation-state time: %w", err)
	}
	return state, nil
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
