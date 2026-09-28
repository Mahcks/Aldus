package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	dbsql "github.com/mahcks/aldus/server/internal/database/sqlc"
)

type AudiobookRecordingDetails struct {
	Publisher      string `json:"publisher"`
	Language       string `json:"language"`
	ReleaseDate    string `json:"release_date"`
	RuntimeMinutes int    `json:"runtime_minutes"`
	Format         string `json:"format"`
}

type AudiobookMetadataValues struct {
	Narrators   []string `json:"narrators"`
	Description string   `json:"description"`
}

type AudiobookMetadataPreview struct {
	Recording      AudiobookRecordingDetails `json:"recording"`
	ASIN           string                    `json:"asin"`
	Region         string                    `json:"region"`
	Title          string                    `json:"title"`
	Authors        []string                  `json:"authors"`
	RuntimeMinutes int                       `json:"runtime_minutes"`
	Format         string                    `json:"format"`
	Current        AudiobookMetadataValues   `json:"current"`
	Values         AudiobookMetadataValues   `json:"values"`
}

type AudiobookMetadataCorrection struct {
	Recording AudiobookRecordingDetails `json:"recording"`
	ASIN      string                    `json:"asin"`
	Region    string                    `json:"region"`
	Fields    []string                  `json:"fields"`
	Expected  AudiobookMetadataValues   `json:"expected"`
	Values    AudiobookMetadataValues   `json:"values"`
}

var audiobookASIN = regexp.MustCompile(`^[A-Z0-9]{10}$`)

func validAudiobookID(asin, region string) bool {
	return audiobookASIN.MatchString(asin) && slices.Contains([]string{"au", "ca", "de", "es", "fr", "in", "it", "jp", "us", "uk"}, region)
}

func fetchAudiobookMetadata(ctx context.Context, client *http.Client, asin, region string) (AudiobookMetadataPreview, error) {
	var result AudiobookMetadataPreview
	if !validAudiobookID(asin, region) {
		return result, ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	safe := *client
	safe.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 || req.URL.Scheme != "https" || req.URL.Host != "api.audnex.us" {
			return ErrMetadataUnavailable
		}
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.audnex.us/books/"+asin+"?region="+region, nil)
	if err != nil {
		return result, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Aldus/metadata (+https://aldus.media)")
	response, err := safe.Do(req)
	if err != nil {
		return result, fmt.Errorf("%w: audiobook lookup failed", ErrMetadataUnavailable)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return result, fmt.Errorf("%w: audiobook provider returned %d", ErrMetadataUnavailable, response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil || len(data) > 2<<20 {
		return result, ErrMetadataUnavailable
	}
	var book struct {
		ASIN    string `json:"asin"`
		Region  string `json:"region"`
		Title   string `json:"title"`
		Authors []struct {
			Name string `json:"name"`
		} `json:"authors"`
		Narrators []struct {
			Name string `json:"name"`
		} `json:"narrators"`
		Publisher   string `json:"publisherName"`
		Language    string `json:"language"`
		ReleaseDate string `json:"releaseDate"`
		Summary     string `json:"summary"`
		Description string `json:"description"`
		Runtime     int    `json:"runtimeLengthMin"`
		Format      string `json:"formatType"`
	}
	if json.Unmarshal(data, &book) != nil || book.ASIN != asin || book.Region != region || book.Title == "" || book.Runtime < 0 || book.Runtime > 100000 {
		return result, ErrMetadataUnavailable
	}
	result = AudiobookMetadataPreview{
		ASIN:           asin,
		Region:         region,
		Title:          metadataText(book.Title, 500),
		Authors:        []string{},
		RuntimeMinutes: book.Runtime,
		Format:         metadataText(book.Format, 100),
	}
	result.Recording = AudiobookRecordingDetails{
		Publisher:      metadataText(book.Publisher, 500),
		Language:       metadataText(book.Language, 100),
		ReleaseDate:    metadataText(book.ReleaseDate, 100),
		RuntimeMinutes: book.Runtime,
		Format:         result.Format,
	}
	for _, author := range book.Authors {
		if len(result.Authors) < 20 {
			result.Authors = append(result.Authors, metadataText(author.Name, 200))
		}
	}
	names := make([]string, 0, len(book.Narrators))
	for _, narrator := range book.Narrators {
		names = append(names, narrator.Name)
	}
	result.Values.Narrators, err = NarratorNames(names)
	if err != nil {
		return AudiobookMetadataPreview{}, ErrMetadataUnavailable
	}
	if book.Summary == "" {
		book.Summary = book.Description
	}
	result.Values.Description = MetadataDescription(book.Summary)
	return result, nil
}

func audiobookMetadataCurrent(ctx context.Context, tx *sql.Tx, actor auth.User, workID, representationID string) (AudiobookMetadataValues, error) {
	current, err := metadataCurrent(ctx, tx, actor, workID)
	if err != nil {
		return AudiobookMetadataValues{}, err
	}
	var kind string
	err = tx.QueryRowContext(ctx, `SELECT kind FROM representations WHERE id = ? AND work_id = ?`, representationID, workID).Scan(&kind)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && kind != "audio" && kind != "audiobook") {
		return AudiobookMetadataValues{}, ErrNotFound
	}
	if err != nil {
		return AudiobookMetadataValues{}, err
	}
	value := AudiobookMetadataValues{Description: current.Description, Narrators: []string{}}
	rows, err := tx.QueryContext(ctx, `SELECT name FROM representation_narrators WHERE representation_id = ? ORDER BY ordinal`, representationID)
	if err != nil {
		return value, err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return value, err
		}
		value.Narrators = append(value.Narrators, name)
	}
	return value, rows.Err()
}

func (s *Store) PreviewAudiobookMetadata(ctx context.Context, actor auth.User, workID, representationID, asin, region string) (AudiobookMetadataPreview, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return AudiobookMetadataPreview{}, err
	}
	current, err := audiobookMetadataCurrent(ctx, tx, actor, workID, representationID)
	tx.Rollback()
	if err != nil {
		return AudiobookMetadataPreview{}, err
	}
	result, err := fetchAudiobookMetadata(ctx, http.DefaultClient, asin, region)
	result.Current = current
	return result, err
}

func (s *Store) ApplyAudiobookMetadata(ctx context.Context, actor auth.User, workID, representationID string, input AudiobookMetadataCorrection) error {
	if !validAudiobookID(input.ASIN, input.Region) || len(input.Fields) == 0 || len(input.Fields) > 2 {
		return ErrInvalid
	}
	if len(input.Recording.Publisher) > 2000 || len(input.Recording.Language) > 400 || len(input.Recording.ReleaseDate) > 400 || len(input.Recording.Format) > 400 || input.Recording.RuntimeMinutes < 0 || input.Recording.RuntimeMinutes > 100000 {
		return ErrInvalid
	}
	recording, err := json.Marshal(input.Recording)
	if err != nil {
		return ErrInvalid
	}
	names, err := NarratorNames(input.Values.Narrators)
	if err != nil || len([]rune(input.Values.Description)) > maxWorkDescriptionRunes {
		return ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	current, err := audiobookMetadataCurrent(ctx, tx, actor, workID, representationID)
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
		case "narrators":
			if !slices.Equal(current.Narrators, input.Expected.Narrators) {
				return ErrMetadataConflict
			}
		case "description":
			if current.Description != input.Expected.Description {
				return ErrMetadataConflict
			}
		default:
			return ErrInvalid
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if selected["narrators"] {
		q := dbsql.New(tx)
		if err := q.DeleteRepresentationNarrators(ctx, representationID); err != nil {
			return err
		}
		for i, name := range names {
			if err := q.InsertRepresentationNarrator(ctx, dbsql.InsertRepresentationNarratorParams{
				RepresentationID: representationID,
				Ordinal:          int64(i),
				Name:             name,
				NameKey:          MetadataKey(name),
			}); err != nil {
				return err
			}
		}
	}
	if selected["description"] {
		description := strings.TrimSpace(input.Values.Description)
		if _, err := tx.ExecContext(ctx, `
 INSERT INTO work_metadata (work_id, description, updated_at)
 VALUES (?, ?, ?)
 ON CONFLICT(work_id) DO UPDATE SET
 description = excluded.description,
 updated_at = excluded.updated_at`, workID, description, now); err != nil {
			return err
		}
		value, _ := json.Marshal(description)
		if _, err := tx.ExecContext(ctx, `
 INSERT INTO work_metadata_sources (
 work_id, field, source, provider_work_id, provider_edition_id, value, updated_at
 ) VALUES (?, 'description', 'audnexus', ?, ?, ?, ?)
 ON CONFLICT(work_id, field) DO UPDATE SET
 source = excluded.source,
 provider_work_id = excluded.provider_work_id,
 provider_edition_id = excluded.provider_edition_id,
 value = excluded.value,
 updated_at = excluded.updated_at`, workID, input.ASIN, input.Region, string(value), now); err != nil {
			return err
		}
	}
	for _, field := range input.Fields {
		var value any = names
		if field == "description" {
			value = strings.TrimSpace(input.Values.Description)
		}
		encoded, _ := json.Marshal(value)
		if _, err := tx.ExecContext(ctx, `
 INSERT INTO representation_metadata_sources (
 representation_id, field, asin, region, value, recording, updated_at
 ) VALUES (?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(representation_id, field) DO UPDATE SET
 asin = excluded.asin,
 region = excluded.region,
 value = excluded.value,
 recording = excluded.recording,
 updated_at = excluded.updated_at`, representationID, field, input.ASIN, input.Region, string(encoded), string(recording), now); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE representations SET updated_at = ? WHERE id = ?`, now, representationID); err != nil {
		return err
	}
	return tx.Commit()
}
