package position

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	dbsql "github.com/mahcks/aldus/server/internal/database/sqlc"
)

func (s *Store) RepresentationState(ctx context.Context, userID, representationID string) (RepresentationState, error) {
	row, err := s.queries.GetRepresentationState(ctx, dbsql.GetRepresentationStateParams{UserID: userID, RepresentationID: representationID})
	return representationStateRow(row, err)
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
	queries := s.queries.WithTx(tx)
	var currentRevision int64
	currentRevision, err = queries.GetRepresentationStateRevision(ctx, dbsql.GetRepresentationStateRevisionParams{UserID: userID, RepresentationID: representationID})
	if errors.Is(err, sql.ErrNoRows) {
		currentRevision = 0
	} else if err != nil {
		return RepresentationState{}, fmt.Errorf("get representation-state revision: %w", err)
	}
	if currentRevision != update.ExpectedRevision {
		row, rowErr := queries.GetRepresentationState(ctx, dbsql.GetRepresentationStateParams{UserID: userID, RepresentationID: representationID})
		current, currentErr := representationStateRow(row, rowErr)
		if currentErr != nil {
			return RepresentationState{}, ErrConflict
		}
		return current, ErrConflict
	}
	now := time.Now().UTC()
	var epub sql.NullString
	if len(update.EPUBLocator) > 0 {
		epub = sql.NullString{String: string(update.EPUBLocator), Valid: true}
	}
	var speed, zoom sql.NullInt64
	if update.PlaybackSpeed != nil {
		speed = sql.NullInt64{Int64: int64(math.Round(*update.PlaybackSpeed * 1000)), Valid: true}
	}
	if update.Zoom != nil {
		zoom = sql.NullInt64{Int64: int64(math.Round(*update.Zoom * 1000)), Valid: true}
	}
	var audio sql.NullInt64
	if update.AudioTimestampMS != nil {
		audio = sql.NullInt64{Int64: *update.AudioTimestampMS, Valid: true}
	}
	err = queries.UpsertRepresentationState(ctx, dbsql.UpsertRepresentationStateParams{
		UserID: userID, RepresentationID: representationID, EpubLocator: epub,
		AudioTimestampMs: audio, PlaybackSpeedMilli: speed,
		ReaderLayout: sql.NullString{String: update.ReaderLayout, Valid: update.ReaderLayout != ""}, ZoomMilli: zoom,
		Revision: currentRevision + 1, UpdatedAt: now.Format(time.RFC3339Nano),
	})
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

func representationStateRow(row dbsql.GetRepresentationStateRow, err error) (RepresentationState, error) {
	var state RepresentationState
	if errors.Is(err, sql.ErrNoRows) {
		return RepresentationState{}, ErrNotFound
	} else if err != nil {
		return RepresentationState{}, err
	}
	state.RepresentationID, state.Revision = row.RepresentationID, row.Revision
	if row.EpubLocator.Valid {
		state.EPUBLocator = json.RawMessage(row.EpubLocator.String)
	}
	if row.AudioTimestampMs.Valid {
		value := row.AudioTimestampMs.Int64
		state.AudioTimestampMS = &value
	}
	if row.PlaybackSpeedMilli.Valid {
		value := float64(row.PlaybackSpeedMilli.Int64) / 1000
		state.PlaybackSpeed = &value
	}
	if row.ZoomMilli.Valid {
		value := float64(row.ZoomMilli.Int64) / 1000
		state.Zoom = &value
	}
	state.ReaderLayout = row.ReaderLayout.String
	state.UpdatedAt, err = time.Parse(time.RFC3339Nano, row.UpdatedAt)
	if err != nil {
		return RepresentationState{}, fmt.Errorf("parse representation-state time: %w", err)
	}
	return state, nil
}
