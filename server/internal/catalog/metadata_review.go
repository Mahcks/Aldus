package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

var ErrMetadataConflict = errors.New("metadata changed since preview")
var metadataWorkID = regexp.MustCompile(`^OL[0-9]+W$`)
var metadataAuthorID = regexp.MustCompile(`^OL[0-9]+A$`)
var metadataEditionID = regexp.MustCompile(`^OL[0-9]+M$`)
var metadataCoverURL = regexp.MustCompile(`^https://covers\.openlibrary\.org/b/id/([1-9][0-9]{0,14})-L\.jpg\?default=false$`)

// MetadataValues describes this catalog title, not the identity of its files.
type MetadataValues struct {
	Title            string   `json:"title"`
	Author           string   `json:"author"`
	Description      string   `json:"description"`
	ISBN             string   `json:"isbn"`
	Publisher        string   `json:"publisher"`
	Language         string   `json:"language"`
	FirstPublishYear int      `json:"first_publish_year"`
	Subjects         []string `json:"subjects"`
	CoverURL         string   `json:"cover_url"`
}

type MetadataCandidate struct {
	WorkID    string
	EditionID string
	Values    MetadataValues
}

type MetadataPreview struct {
	Current    MetadataValues
	Candidates []MetadataCandidate
}

type MetadataCorrection struct {
	WorkID    string
	EditionID string
	Fields    []string
	Expected  MetadataValues
	Values    MetadataValues
}

func metadataFieldValue(value MetadataValues, field string) any {
	switch field {
	case "title":
		return value.Title
	case "author":
		return value.Author
	case "description":
		return value.Description
	case "isbn":
		return value.ISBN
	case "publisher":
		return value.Publisher
	case "language":
		return value.Language
	case "first_publish_year":
		return value.FirstPublishYear
	case "subjects":
		return value.Subjects
	case "cover_url":
		return value.CoverURL
	default:
		return nil
	}
}

func metadataCurrent(ctx context.Context, tx *sql.Tx, actor auth.User, id string) (MetadataValues, error) {
	var value MetadataValues
	var legacySubjects string
	args := append([]any{actor.ID, id}, auth.LibraryEditArgs(actor)...)
	const query = `
    SELECT w.title, COALESCE(w.author, ''), COALESCE(md.description, ''),
           COALESCE(md.isbn, ''), COALESCE(md.publisher, ''), COALESCE(md.language, ''),
           COALESCE(md.first_publish_year, 0), COALESCE(c.image_url, ''), COALESCE(md.subjects, '')
    FROM works w
    LEFT JOIN work_metadata md ON md.work_id = w.id
    LEFT JOIN work_covers c ON c.id = w.selected_cover_id
    LEFT JOIN library_members m ON m.library_id = w.library_id AND m.user_id = ?
    WHERE w.id = ? AND `
	err := tx.QueryRowContext(ctx, query+auth.EffectiveLibraryEditSQL("w.library_id", "m"), args...).Scan(
		&value.Title, &value.Author, &value.Description, &value.ISBN,
		&value.Publisher, &value.Language, &value.FirstPublishYear, &value.CoverURL, &legacySubjects,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return value, ErrNotFound
	}
	if err != nil {
		return value, err
	}
	value.Subjects = []string{}
	rows, err := tx.QueryContext(ctx, `SELECT subject FROM work_subjects WHERE work_id=? ORDER BY ordinal`, id)
	if err != nil {
		return value, err
	}
	defer rows.Close()
	for rows.Next() {
		var subject string
		if err := rows.Scan(&subject); err != nil {
			return value, err
		}
		value.Subjects = append(value.Subjects, subject)
	}
	if len(value.Subjects) == 0 && legacySubjects != "" {
		value.Subjects = strings.Split(legacySubjects, ",")
	}
	return value, rows.Err()
}

func (s *Store) MetadataCurrent(ctx context.Context, actor auth.User, id string) (MetadataValues, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MetadataValues{}, err
	}
	defer tx.Rollback()
	return metadataCurrent(ctx, tx, actor, id)
}

func (s *Store) ApplyMetadata(ctx context.Context, actor auth.User, id string, input MetadataCorrection) error {
	if !metadataWorkID.MatchString(input.WorkID) {
		return ErrInvalid
	}
	if input.EditionID != "" && !metadataEditionID.MatchString(input.EditionID) {
		return ErrInvalid
	}
	if len(input.Fields) == 0 || len(input.Fields) > 9 {
		return ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	current, err := metadataCurrent(ctx, tx, actor, id)
	if err != nil {
		return err
	}
	selected := make(map[string]bool, len(input.Fields))
	for _, field := range input.Fields {
		if selected[field] {
			return ErrInvalid
		}
		selected[field] = true
		if err := applyMetadataField(&current, input.Expected, input.Values, field); err != nil {
			return err
		}
	}
	if selected["cover_url"] && current.CoverURL != "" && !metadataCoverURL.MatchString(current.CoverURL) {
		return ErrInvalid
	}
	update := WorkUpdate{
		Title:            current.Title,
		Author:           current.Author,
		Description:      current.Description,
		ISBN:             current.ISBN,
		Publisher:        current.Publisher,
		Language:         current.Language,
		FirstPublishYear: current.FirstPublishYear,
		Subjects:         current.Subjects,
	}
	if err := updateWorkTx(ctx, tx, actor, id, update); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if selected["cover_url"] {
		if err := applyMetadataCover(ctx, tx, id, current.CoverURL, now); err != nil {
			return err
		}
	}
	// Read normalized values back before recording their correction source.
	current, err = metadataCurrent(ctx, tx, actor, id)
	if err != nil {
		return err
	}
	// Keep one correction source per field, not unbounded provider payloads.
	for _, field := range input.Fields {
		value, _ := json.Marshal(metadataFieldValue(current, field))
		if _, err := tx.ExecContext(ctx, `
		INSERT INTO work_metadata_sources (
		work_id, field, source, provider_work_id, provider_edition_id, value, updated_at
		) VALUES (?, ?, 'open_library', ?, ?, ?, ?)
		ON CONFLICT(work_id, field) DO UPDATE SET
		source = excluded.source,
		provider_work_id = excluded.provider_work_id,
		provider_edition_id = excluded.provider_edition_id,
		value = excluded.value,
		updated_at = excluded.updated_at`, id, field, input.WorkID, input.EditionID, string(value), now); err != nil {
			return fmt.Errorf("save metadata source: %w", err)
		}
	}
	return tx.Commit()
}

func metadataText(value string, limit int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}

func applyMetadataField(current *MetadataValues, expected, proposed MetadataValues, field string) error {
	switch field {
	case "title":
		if current.Title != expected.Title {
			return ErrMetadataConflict
		}
		current.Title = proposed.Title
	case "author":
		if current.Author != expected.Author {
			return ErrMetadataConflict
		}
		current.Author = proposed.Author
	case "description":
		if current.Description != expected.Description {
			return ErrMetadataConflict
		}
		current.Description = proposed.Description
	case "isbn":
		if current.ISBN != expected.ISBN {
			return ErrMetadataConflict
		}
		current.ISBN = proposed.ISBN
	case "publisher":
		if current.Publisher != expected.Publisher {
			return ErrMetadataConflict
		}
		current.Publisher = proposed.Publisher
	case "language":
		if current.Language != expected.Language {
			return ErrMetadataConflict
		}
		current.Language = proposed.Language
	case "first_publish_year":
		if current.FirstPublishYear != expected.FirstPublishYear {
			return ErrMetadataConflict
		}
		current.FirstPublishYear = proposed.FirstPublishYear
	case "cover_url":
		if current.CoverURL != expected.CoverURL {
			return ErrMetadataConflict
		}
		current.CoverURL = proposed.CoverURL
	case "subjects":
		if !slices.Equal(current.Subjects, expected.Subjects) {
			return ErrMetadataConflict
		}
		current.Subjects = proposed.Subjects
	default:
		return ErrInvalid
	}
	return nil
}

func applyMetadataCover(ctx context.Context, tx *sql.Tx, id, coverURL, now string) error {
	if coverURL == "" {
		if _, err := tx.ExecContext(ctx, `UPDATE works SET selected_cover_id=NULL WHERE id=?`, id); err != nil {
			return err
		}
	} else {
		coverID := metadataCoverURL.FindStringSubmatch(coverURL)[1]
		recordID, err := randomID()
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
		INSERT INTO work_covers (id, work_id, source, source_id, image_url, created_at)
		VALUES (?, ?, 'open_library', ?, ?, ?)
		ON CONFLICT(work_id, source, source_id) DO NOTHING`, recordID, id, coverID, coverURL, now); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
		UPDATE works SET selected_cover_id = (
		SELECT id FROM work_covers WHERE work_id = ? AND source = 'open_library' AND source_id = ?
		) WHERE id = ?`, id, coverID, id); err != nil {
			return err
		}
	}
	return nil
}
