package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	dbsql "github.com/mahcks/aldus/server/internal/database/sqlc"
)

// FileMetadataValues separates title details from the selected recording's credits.
type FileMetadataValues struct {
	Values         MetadataValues `json:"values"`
	Series         string         `json:"series"`
	SeriesPosition string         `json:"series_position"`
	Narrators      []string       `json:"narrators"`
}

type FileMetadataCorrection struct {
	Fields   []string
	Expected FileMetadataValues
	Values   FileMetadataValues
}

func fileMetadataCurrent(ctx context.Context, tx *sql.Tx, actor auth.User, mediaID string) (FileMetadataValues, string, string, string, error) {
	var result FileMetadataValues
	var workID, representationID, kind string
	err := tx.QueryRowContext(ctx, `
		SELECT r.work_id, r.id, r.kind
		FROM media m
		JOIN representations r ON r.id = m.representation_id
		WHERE m.id = ?`, mediaID).Scan(&workID, &representationID, &kind)
	if errors.Is(err, sql.ErrNoRows) {
		return result, "", "", "", ErrNotFound
	}
	if err != nil {
		return result, "", "", "", err
	}
	result.Values, err = metadataCurrent(ctx, tx, actor, workID)
	if err != nil {
		return result, "", "", "", err
	}
	var order *int64
	if err := tx.QueryRowContext(ctx, `SELECT series_name,series_order FROM works WHERE id=?`, workID).Scan(&result.Series, &order); err != nil {
		return result, "", "", "", err
	}
	result.SeriesPosition = SeriesPosition(order)
	result.Narrators, err = dbsql.New(tx).RepresentationNarrators(ctx, representationID)
	if result.Narrators == nil {
		result.Narrators = []string{}
	}
	return result, workID, representationID, kind, err
}

func (s *Store) FileMetadataCurrent(ctx context.Context, actor auth.User, mediaID string) (FileMetadataValues, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return FileMetadataValues{}, err
	}
	defer tx.Rollback()

	current, _, _, _, err := fileMetadataCurrent(ctx, tx, actor, mediaID)
	return current, err
}

// ApplyFileMetadata is an explicit, selected-field correction. It never modifies
// the media, its representation identity, alignment, or saved reading position.
func (s *Store) ApplyFileMetadata(ctx context.Context, actor auth.User, mediaID string, input FileMetadataCorrection) error {
	if len(input.Fields) == 0 || len(input.Fields) > 10 {
		return ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	current, workID, representationID, kind, err := fileMetadataCurrent(ctx, tx, actor, mediaID)
	if err != nil {
		return err
	}

	selected := map[string]bool{}
	for _, field := range input.Fields {
		if selected[field] {
			return ErrInvalid
		}
		selected[field] = true
		switch field {
		case "series":
			if current.Series != input.Expected.Series || current.SeriesPosition != input.Expected.SeriesPosition {
				return ErrMetadataConflict
			}
			current.Series = input.Values.Series
			current.SeriesPosition = input.Values.SeriesPosition
		case "narrators":
			if kind == "epub" {
				return ErrInvalid
			}
			if !slices.Equal(current.Narrators, input.Expected.Narrators) {
				return ErrMetadataConflict
			}
			current.Narrators, err = NarratorNames(input.Values.Narrators)
			if err != nil {
				return err
			}
		case "cover_url":
			return ErrInvalid
		default:
			if err := applyMetadataField(&current.Values, input.Expected.Values, input.Values.Values, field); err != nil {
				return err
			}
		}
	}

	update := WorkUpdate{
		Title:            current.Values.Title,
		Author:           current.Values.Author,
		Description:      current.Values.Description,
		ISBN:             current.Values.ISBN,
		Publisher:        current.Values.Publisher,
		Language:         current.Values.Language,
		FirstPublishYear: current.Values.FirstPublishYear,
		Subjects:         current.Values.Subjects,
	}
	if selected["series"] {
		update.Series = &current.Series
		update.SeriesPosition = &current.SeriesPosition
	}
	if err := updateWorkTx(ctx, tx, actor, workID, update); err != nil {
		return err
	}
	if selected["narrators"] {
		queries := dbsql.New(tx)
		if err := queries.DeleteRepresentationNarrators(ctx, representationID); err != nil {
			return err
		}
		for i, name := range current.Narrators {
			if err := queries.InsertRepresentationNarrator(ctx, dbsql.InsertRepresentationNarratorParams{
				RepresentationID: representationID,
				Ordinal:          int64(i),
				Name:             name,
				NameKey:          MetadataKey(name),
			}); err != nil {
				return err
			}
		}
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, field := range input.Fields {
		if field == "series" || field == "narrators" {
			continue
		}
		value, _ := json.Marshal(metadataFieldValue(current.Values, field))
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO work_metadata_sources(
				work_id, field, source, provider_work_id, provider_edition_id, value, updated_at
			) VALUES (?, ?, 'file', ?, '', ?, ?)
			ON CONFLICT(work_id, field) DO UPDATE SET
				source = excluded.source,
				provider_work_id = excluded.provider_work_id,
				provider_edition_id = '',
				value = excluded.value,
				updated_at = excluded.updated_at`, workID, field, mediaID, string(value), now); err != nil {
			return err
		}
	}

	return tx.Commit()
}
