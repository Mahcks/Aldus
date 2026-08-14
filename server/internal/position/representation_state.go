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
	var speed, zoom, lineHeight, margin sql.NullInt64
	if update.PlaybackSpeed != nil {
		speed = sql.NullInt64{Int64: int64(math.Round(*update.PlaybackSpeed * 1000)), Valid: true}
	}
	if update.Zoom != nil {
		zoom = sql.NullInt64{Int64: int64(math.Round(*update.Zoom * 1000)), Valid: true}
	}
	if update.LineHeight != nil {
		lineHeight = sql.NullInt64{Int64: int64(math.Round(*update.LineHeight * 1000)), Valid: true}
	}
	if update.Margin != nil {
		margin = sql.NullInt64{Int64: int64(math.Round(*update.Margin * 1000)), Valid: true}
	}
	var audio sql.NullInt64
	if update.AudioTimestampMS != nil {
		audio = sql.NullInt64{Int64: *update.AudioTimestampMS, Valid: true}
	}
	err = queries.UpsertRepresentationState(ctx, dbsql.UpsertRepresentationStateParams{
		UserID: userID, RepresentationID: representationID, EpubLocator: epub,
		AudioTimestampMs: audio, PlaybackSpeedMilli: speed,
		ReaderLayout: sql.NullString{String: update.ReaderLayout, Valid: update.ReaderLayout != ""}, ZoomMilli: zoom,
		ReaderTheme: sql.NullString{String: update.ReaderTheme, Valid: update.ReaderTheme != ""}, LineHeightMilli: lineHeight, MarginMilli: margin,
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
	if len(update.EPUBLocator) > 0 && !json.Valid(update.EPUBLocator) || update.AudioTimestampMS != nil && *update.AudioTimestampMS < 0 || update.PlaybackSpeed != nil && (*update.PlaybackSpeed < .25 || *update.PlaybackSpeed > 4) || update.Zoom != nil && (*update.Zoom < .5 || *update.Zoom > 3) || update.LineHeight != nil && (*update.LineHeight < 1.2 || *update.LineHeight > 2.2) || update.Margin != nil && (*update.Margin < 0 || *update.Margin > 4) || update.ReaderLayout != "" && update.ReaderLayout != "paginated" && update.ReaderLayout != "scrolled" || update.ReaderTheme != "" && update.ReaderTheme != "paper" && update.ReaderTheme != "sepia" {
		return false
	}
	return len(update.EPUBLocator) > 0 || update.AudioTimestampMS != nil || update.PlaybackSpeed != nil || update.Zoom != nil || update.LineHeight != nil || update.Margin != nil || update.ReaderLayout != "" || update.ReaderTheme != ""
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
	if row.LineHeightMilli.Valid {
		value := float64(row.LineHeightMilli.Int64) / 1000
		state.LineHeight = &value
	}
	if row.MarginMilli.Valid {
		value := float64(row.MarginMilli.Int64) / 1000
		state.Margin = &value
	}
	state.ReaderLayout = row.ReaderLayout.String
	state.ReaderTheme = row.ReaderTheme.String
	state.UpdatedAt, err = time.Parse(time.RFC3339Nano, row.UpdatedAt)
	if err != nil {
		return RepresentationState{}, fmt.Errorf("parse representation-state time: %w", err)
	}
	return state, nil
}
