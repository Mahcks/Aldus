package position

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"time"

	dbsql "github.com/mahcks/aldus/server/internal/database/sqlc"
)

func DefaultReaderPreferences() ReaderPreferences {
	return ReaderPreferences{
		ReaderLayout: "paginated",
		Zoom:         1,
		ReaderTheme:  "paper",
		LineHeight:   1.72,
		Margin:       2,
		FontFamily:   "serif",
	}
}

func (s *Store) ReaderPreferences(ctx context.Context, userID string) (ReaderPreferences, error) {
	row, err := s.queries.GetReaderPreferences(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultReaderPreferences(), nil
	}
	return readerPreferencesRow(row, err)
}

func (s *Store) UpdateReaderPreferences(ctx context.Context, userID string, update ReaderPreferencesUpdate) (ReaderPreferences, error) {
	if !validReaderPreferencesUpdate(update) {
		return ReaderPreferences{}, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ReaderPreferences{}, fmt.Errorf("begin reader-preferences update: %w", err)
	}
	defer tx.Rollback()
	queries := s.queries.WithTx(tx)
	currentRevision, err := queries.GetReaderPreferencesRevision(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		currentRevision = 0
	} else if err != nil {
		return ReaderPreferences{}, fmt.Errorf("get reader-preferences revision: %w", err)
	}
	if currentRevision != update.ExpectedRevision {
		row, rowErr := queries.GetReaderPreferences(ctx, userID)
		current, currentErr := readerPreferencesRow(row, rowErr)
		if currentErr != nil {
			return ReaderPreferences{}, ErrConflict
		}
		return current, ErrConflict
	}
	now := time.Now().UTC()
	err = queries.UpsertReaderPreferences(ctx, dbsql.UpsertReaderPreferencesParams{
		UserID:          userID,
		ReaderLayout:    update.ReaderLayout,
		ZoomMilli:       int64(math.Round(update.Zoom * 1000)),
		ReaderTheme:     update.ReaderTheme,
		LineHeightMilli: int64(math.Round(update.LineHeight * 1000)),
		MarginMilli:     int64(math.Round(update.Margin * 1000)),
		FontFamily:      update.FontFamily,
		Revision:        currentRevision + 1,
		UpdatedAt:       now.Format(time.RFC3339Nano),
	})
	if err != nil {
		return ReaderPreferences{}, fmt.Errorf("save reader preferences: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return ReaderPreferences{}, fmt.Errorf("commit reader preferences: %w", err)
	}
	return s.ReaderPreferences(ctx, userID)
}

func validReaderPreferencesUpdate(update ReaderPreferencesUpdate) bool {
	return (update.ReaderLayout == "paginated" || update.ReaderLayout == "scrolled") &&
		update.Zoom >= .5 && update.Zoom <= 3 &&
		(update.ReaderTheme == "paper" || update.ReaderTheme == "sepia" || update.ReaderTheme == "night") &&
		update.LineHeight >= 1.2 && update.LineHeight <= 2.2 &&
		update.Margin >= 0 && update.Margin <= 4 &&
		validFontFamily(update.FontFamily)
}

func readerPreferencesRow(row dbsql.GetReaderPreferencesRow, err error) (ReaderPreferences, error) {
	if err != nil {
		return ReaderPreferences{}, err
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, row.UpdatedAt)
	if err != nil {
		return ReaderPreferences{}, fmt.Errorf("parse reader-preferences time: %w", err)
	}
	return ReaderPreferences{
		ReaderLayout: row.ReaderLayout,
		Zoom:         float64(row.ZoomMilli) / 1000,
		ReaderTheme:  row.ReaderTheme,
		LineHeight:   float64(row.LineHeightMilli) / 1000,
		Margin:       float64(row.MarginMilli) / 1000,
		FontFamily:   row.FontFamily,
		Revision:     row.Revision,
		UpdatedAt:    updatedAt,
	}, nil
}
