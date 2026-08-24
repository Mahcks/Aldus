package catalog

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

type CoverCandidate struct {
	Source, SourceID, ImageURL, Title, Author, Publisher, ISBN string
	WorkID                                                     string
	FirstPublishYear                                           int
	Language, Subjects                                         string
}

type CoverAsset struct {
	ID, Source, SourceID, ImageURL, Label string
	Selected                              bool
	CreatedAt                             time.Time
}

type CoverSettings struct {
	Fit, Style, Layout   string
	FocalX, FocalY, Tone int
}

type openLibraryResult struct {
	Docs []struct {
		Key              string   `json:"key"`
		CoverID          int      `json:"cover_i"`
		Title            string   `json:"title"`
		Authors          []string `json:"author_name"`
		FirstPublishYear int      `json:"first_publish_year"`
		Publishers       []string `json:"publisher"`
		ISBNs            []string `json:"isbn"`
		Languages        []string `json:"language"`
		Subjects         []string `json:"subject"`
	} `json:"docs"`
}

const maxWorkSubjects = 5

// Open Library's `subject` field mixes real subject/genre tags ("Fiction",
// "New York Times bestseller") with internal facet keys used for their own
// browse UI ("series:Twilight", "nyt:series_books=2008-03-15", "person:...",
// "place:...", "time:..."). Every one of those facet keys is namespaced with
// a colon; genuine subjects never contain one, so that's the reliable tell.
func cleanOpenLibrarySubjects(subjects []string) []string {
	cleaned := make([]string, 0, min(len(subjects), maxWorkSubjects))
	for _, subject := range subjects {
		if strings.Contains(subject, ":") {
			continue
		}
		cleaned = append(cleaned, subject)
		if len(cleaned) == maxWorkSubjects {
			break
		}
	}
	return cleaned
}

const maxWorkDescriptionRunes = 4000

type refreshedMetadata struct {
	CoverID, Description, ISBN, Publisher, Language, Subjects string
	FirstPublishYear                                          int
}

func (s *Store) RefreshMetadata(ctx context.Context, actor auth.User, workID string) (WorkDetail, error) {
	work, err := s.editableWork(ctx, actor, workID)
	if err != nil {
		return WorkDetail{}, err
	}
	query := strings.TrimSpace(work.Title + " " + work.Author)
	endpoint := "https://openlibrary.org/search.json?limit=12&fields=key,cover_i,title,author_name,first_publish_year,publisher,isbn,language,subject&q=" + url.QueryEscape(query)
	metadata, err := refreshOpenLibraryMetadata(ctx, &http.Client{Timeout: 10 * time.Second}, endpoint, work.Title, work.Author, func(id string) string {
		return "https://openlibrary.org/works/" + url.PathEscape(id) + ".json"
	}, func(id string) string {
		return "https://openlibrary.org/works/" + url.PathEscape(id) + "/editions.json?limit=50"
	})
	if err != nil {
		return WorkDetail{}, err
	}
	if err := s.saveRefreshedMetadata(ctx, workID, metadata); err != nil {
		return WorkDetail{}, err
	}
	return s.WorkDetail(ctx, actor, workID)
}

func (s *Store) saveRefreshedMetadata(ctx context.Context, workID string, metadata refreshedMetadata) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO work_metadata(work_id,cover_url,source,description,isbn,first_publish_year,publisher,language,subjects,updated_at) VALUES(?,?,'open_library',?,?,?,?,?,?,?)
		ON CONFLICT(work_id) DO UPDATE SET
			cover_url=CASE WHEN work_metadata.cover_url='' THEN excluded.cover_url ELSE work_metadata.cover_url END,
			description=CASE WHEN work_metadata.description='' THEN excluded.description ELSE work_metadata.description END,
			isbn=CASE WHEN work_metadata.isbn='' THEN excluded.isbn ELSE work_metadata.isbn END,
			first_publish_year=CASE WHEN work_metadata.first_publish_year=0 THEN excluded.first_publish_year ELSE work_metadata.first_publish_year END,
			publisher=CASE WHEN work_metadata.publisher='' THEN excluded.publisher ELSE work_metadata.publisher END,
			language=CASE WHEN work_metadata.language='' THEN excluded.language ELSE work_metadata.language END,
			subjects=CASE WHEN work_metadata.subjects='' THEN excluded.subjects ELSE work_metadata.subjects END,
			updated_at=excluded.updated_at`,
		workID, openLibraryCoverURL(metadata.CoverID), metadata.Description, metadata.ISBN, metadata.FirstPublishYear, metadata.Publisher, metadata.Language, metadata.Subjects, now); err != nil {
		return fmt.Errorf("save refreshed metadata: %w", err)
	}
	coverRecordID, err := randomID()
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO work_covers(id,work_id,source,source_id,image_url,created_at) SELECT ?,?,'open_library',?,?,? FROM works WHERE id=? AND selected_cover_id IS NULL ON CONFLICT(work_id,source,source_id) DO NOTHING`, coverRecordID, workID, metadata.CoverID, openLibraryCoverURL(metadata.CoverID), now, workID); err != nil {
		return fmt.Errorf("save refreshed cover: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE works SET selected_cover_id=(SELECT id FROM work_covers WHERE work_id=? AND source='open_library' AND source_id=?),updated_at=? WHERE id=? AND selected_cover_id IS NULL`, workID, metadata.CoverID, now, workID); err != nil {
		return fmt.Errorf("select refreshed cover: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return nil
}

func refreshOpenLibraryMetadata(ctx context.Context, client *http.Client, searchEndpoint, title, author string, workEndpoint, editionsEndpoint func(string) string) (refreshedMetadata, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, searchEndpoint, nil)
	if err != nil {
		return refreshedMetadata{}, err
	}
	request.Header.Set("User-Agent", "Aldus/1.0 (self-hosted book library)")
	response, err := client.Do(request)
	if err != nil {
		return refreshedMetadata{}, fmt.Errorf("search Open Library: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return refreshedMetadata{}, fmt.Errorf("search Open Library: unexpected status %d", response.StatusCode)
	}
	candidates, err := parseOpenLibraryCovers(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return refreshedMetadata{}, fmt.Errorf("decode Open Library search: %w", err)
	}
	var selected CoverCandidate
	for _, candidate := range candidates {
		if normalizedMetadataText(candidate.Title) == normalizedMetadataText(title) && (strings.TrimSpace(author) == "" || normalizedMetadataText(candidate.Author) == normalizedMetadataText(author)) {
			selected = candidate
			break
		}
	}
	if selected.SourceID == "" || selected.WorkID == "" {
		return refreshedMetadata{}, ErrNotFound
	}
	description, err := openLibraryDescription(ctx, client, workEndpoint(selected.WorkID))
	if err != nil {
		return refreshedMetadata{}, err
	}
	// The search doc aggregates every edition of the work into flat arrays —
	// language[0], publisher[0], and isbn[0] can each come from a different
	// translation, so used together they can describe an edition that never
	// existed (e.g. a Spanish publisher paired with an English printing).
	// The editions endpoint returns one record per real edition; use it to
	// pull correlated fields for a same-language, preferably English, one.
	if edition, ok := openLibraryEnglishEdition(ctx, client, editionsEndpoint(selected.WorkID)); ok {
		selected.Language = edition.Language
		selected.Publisher = edition.Publisher
		selected.ISBN = edition.ISBN
	}
	return refreshedMetadata{
		CoverID:          selected.SourceID,
		Description:      description,
		ISBN:             selected.ISBN,
		FirstPublishYear: selected.FirstPublishYear,
		Publisher:        selected.Publisher,
		Language:         selected.Language,
		Subjects:         selected.Subjects,
	}, nil
}

type openLibraryEdition struct {
	Language, Publisher, ISBN string
}

// openLibraryEnglishEdition picks the first edition that isn't explicitly
// tagged with a non-English language — many pre-1923 English originals in
// Open Library have no language tag at all, so "not explicitly foreign" is
// the reliable signal here, not "explicitly English."
func openLibraryEnglishEdition(ctx context.Context, client *http.Client, endpoint string) (openLibraryEdition, bool) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return openLibraryEdition{}, false
	}
	request.Header.Set("User-Agent", "Aldus/1.0 (self-hosted book library)")
	response, err := client.Do(request)
	if err != nil || response.StatusCode != http.StatusOK {
		if response != nil {
			response.Body.Close()
		}
		return openLibraryEdition{}, false
	}
	defer response.Body.Close()
	var payload struct {
		Entries []struct {
			Publishers []string `json:"publishers"`
			ISBN13     []string `json:"isbn_13"`
			ISBN10     []string `json:"isbn_10"`
			Languages  []struct {
				Key string `json:"key"`
			} `json:"languages"`
		} `json:"entries"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&payload); err != nil {
		return openLibraryEdition{}, false
	}
	for _, entry := range payload.Entries {
		language := ""
		foreign := false
		for _, tag := range entry.Languages {
			code := strings.TrimPrefix(tag.Key, "/languages/")
			if code == "eng" {
				language = code
			} else if code != "" {
				foreign = true
			}
		}
		if foreign {
			continue
		}
		edition := openLibraryEdition{Language: language}
		if len(entry.Publishers) > 0 {
			edition.Publisher = entry.Publishers[0]
		}
		if len(entry.ISBN13) > 0 {
			edition.ISBN = entry.ISBN13[0]
		} else if len(entry.ISBN10) > 0 {
			edition.ISBN = entry.ISBN10[0]
		}
		if edition.Publisher != "" || edition.ISBN != "" || edition.Language != "" {
			return edition, true
		}
	}
	return openLibraryEdition{}, false
}

func openLibraryDescription(ctx context.Context, client *http.Client, endpoint string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("User-Agent", "Aldus/1.0 (self-hosted book library)")
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("load Open Library work: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("load Open Library work: unexpected status %d", response.StatusCode)
	}
	var payload struct {
		Description json.RawMessage `json:"description"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload); err != nil {
		return "", err
	}
	var description string
	if json.Unmarshal(payload.Description, &description) != nil {
		var object struct {
			Value string `json:"value"`
		}
		_ = json.Unmarshal(payload.Description, &object)
		description = object.Value
	}
	description = strings.TrimSpace(description)
	runes := []rune(description)
	if len(runes) > maxWorkDescriptionRunes {
		description = strings.TrimSpace(string(runes[:maxWorkDescriptionRunes]))
	}
	return description, nil
}

func normalizedMetadataText(value string) string {
	var result strings.Builder
	for _, r := range strings.ToLower(value) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			result.WriteRune(r)
		}
	}
	return result.String()
}

func (s *Store) SearchCovers(ctx context.Context, actor auth.User, workID, query string) ([]CoverCandidate, error) {
	work, err := s.editableWork(ctx, actor, workID)
	if err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if query == "" {
		query = strings.TrimSpace(work.Title + " " + work.Author)
	}
	if query == "" || len(query) > 200 {
		return nil, ErrInvalid
	}
	endpoint := "https://openlibrary.org/search.json?limit=12&fields=cover_i,title,author_name,first_publish_year,publisher,isbn&q=" + url.QueryEscape(query)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "Aldus/1.0 (self-hosted book library)")
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(request)
	if err != nil {
		return nil, fmt.Errorf("search Open Library: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("search Open Library: unexpected status %d", response.StatusCode)
	}
	candidates, err := parseOpenLibraryCovers(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, fmt.Errorf("decode Open Library search: %w", err)
	}
	return candidates, nil
}

func parseOpenLibraryCovers(reader io.Reader) ([]CoverCandidate, error) {
	var result openLibraryResult
	if err := json.NewDecoder(reader).Decode(&result); err != nil {
		return nil, err
	}
	candidates := make([]CoverCandidate, 0, len(result.Docs))
	seen := make(map[int]bool)
	for _, doc := range result.Docs {
		if doc.CoverID <= 0 || seen[doc.CoverID] {
			continue
		}
		seen[doc.CoverID] = true
		candidate := CoverCandidate{Source: "open_library", SourceID: strconv.Itoa(doc.CoverID), WorkID: strings.TrimPrefix(doc.Key, "/works/"), ImageURL: openLibraryCoverURL(strconv.Itoa(doc.CoverID)), Title: doc.Title, FirstPublishYear: doc.FirstPublishYear}
		if len(doc.Authors) > 0 {
			candidate.Author = doc.Authors[0]
		}
		if len(doc.Publishers) > 0 {
			candidate.Publisher = doc.Publishers[0]
		}
		if len(doc.ISBNs) > 0 {
			candidate.ISBN = doc.ISBNs[0]
		}
		if len(doc.Languages) > 0 {
			candidate.Language = doc.Languages[0]
		}
		if subjects := cleanOpenLibrarySubjects(doc.Subjects); len(subjects) > 0 {
			candidate.Subjects = strings.Join(subjects, ",")
		}
		candidates = append(candidates, candidate)
	}
	return candidates, nil
}

func (s *Store) SelectCover(ctx context.Context, actor auth.User, workID, source, sourceID string) error {
	if _, err := s.editableWork(ctx, actor, workID); err != nil {
		return err
	}
	imageURL := ""
	if source == "upload" {
		if err := s.db.QueryRowContext(ctx, `SELECT image_url FROM work_covers WHERE work_id=? AND source='upload' AND source_id=?`, workID, sourceID).Scan(&imageURL); err != nil {
			return ErrInvalid
		}
	} else if source == "embedded" {
		var count int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM media m JOIN representations r ON r.id=m.representation_id WHERE m.id=? AND r.work_id=?`, sourceID, workID).Scan(&count); err != nil || count != 1 {
			return ErrInvalid
		}
		imageURL = "/api/media/" + url.PathEscape(sourceID) + "/cover"
	} else if source != "open_library" {
		return ErrInvalid
	}
	if source == "open_library" {
		coverID, err := strconv.Atoi(sourceID)
		if err != nil || coverID <= 0 {
			return ErrInvalid
		}
		imageURL = openLibraryCoverURL(sourceID)
	}
	id, err := randomID()
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if source != "upload" {
		_, err = tx.ExecContext(ctx, `INSERT INTO work_covers(id,work_id,source,source_id,image_url,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(work_id,source,source_id) DO NOTHING`, id, workID, source, sourceID, imageURL, time.Now().UTC().Format(time.RFC3339Nano))
		if err != nil {
			return fmt.Errorf("save work cover: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE works SET selected_cover_id=(SELECT id FROM work_covers WHERE work_id=? AND source=? AND source_id=?),updated_at=? WHERE id=?`, workID, source, sourceID, time.Now().UTC().Format(time.RFC3339Nano), workID); err != nil {
		return fmt.Errorf("select work cover: %w", err)
	}
	return tx.Commit()
}

func (s *Store) RestoreCover(ctx context.Context, actor auth.User, workID string) error {
	if _, err := s.editableWork(ctx, actor, workID); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE works SET selected_cover_id=NULL,updated_at=? WHERE id=?`, time.Now().UTC().Format(time.RFC3339Nano), workID)
	return err
}

func (s *Store) Covers(ctx context.Context, actor auth.User, workID string) ([]CoverAsset, error) {
	if _, err := s.editableWork(ctx, actor, workID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT c.id,c.source,c.source_id,c.image_url,COALESCE(c.id=w.selected_cover_id,0),c.created_at FROM work_covers c JOIN works w ON w.id=c.work_id WHERE c.work_id=? ORDER BY c.created_at DESC,c.id`, workID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var values []CoverAsset
	for rows.Next() {
		var value CoverAsset
		var created string
		if err := rows.Scan(&value.ID, &value.Source, &value.SourceID, &value.ImageURL, &value.Selected, &created); err != nil {
			return nil, err
		}
		value.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		value.Label = coverSourceLabel(value.Source)
		values = append(values, value)
	}
	return values, rows.Err()
}

func (s *Store) UpdateCoverSettings(ctx context.Context, actor auth.User, workID string, settings CoverSettings) error {
	if _, err := s.editableWork(ctx, actor, workID); err != nil {
		return err
	}
	if !oneOf(settings.Fit, "cover", "contain") || settings.FocalX < 0 || settings.FocalX > 100 || settings.FocalY < 0 || settings.FocalY > 100 || !oneOf(settings.Style, "classic", "minimal", "framed") || settings.Tone < -1 || settings.Tone > 4 || !oneOf(settings.Layout, "top", "center", "bottom") {
		return ErrInvalid
	}
	_, err := s.db.ExecContext(ctx, `UPDATE works SET cover_fit=?,cover_focal_x=?,cover_focal_y=?,generated_cover_style=?,generated_cover_tone=?,generated_cover_layout=?,updated_at=? WHERE id=?`, settings.Fit, settings.FocalX, settings.FocalY, settings.Style, settings.Tone, settings.Layout, time.Now().UTC().Format(time.RFC3339Nano), workID)
	return err
}

func (s *Store) DeleteCover(ctx context.Context, actor auth.User, workID, coverID string) error {
	if _, err := s.editableWork(ctx, actor, workID); err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM work_covers WHERE id=? AND work_id=? AND source='upload'`, coverID, workID)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) UploadCover(ctx context.Context, actor auth.User, workID string, reader io.Reader) error {
	if _, err := s.editableWork(ctx, actor, workID); err != nil {
		return err
	}
	data, err := io.ReadAll(io.LimitReader(reader, 10<<20+1))
	if err != nil || len(data) == 0 || len(data) > 10<<20 {
		return ErrInvalid
	}
	config, imageType, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 40_000_000 || (imageType != "jpeg" && imageType != "png") {
		return ErrInvalid
	}
	id, err := randomID()
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	contentType := "image/" + imageType
	if _, err := tx.ExecContext(ctx, `INSERT INTO work_covers(id,work_id,source,source_id,image_url,image_data,image_type,created_at) VALUES(?,?,?,?,?,?,?,?)`, id, workID, "upload", id, "/api/covers/"+id, data, contentType, now); err != nil {
		return fmt.Errorf("save uploaded cover: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE works SET selected_cover_id=?,updated_at=? WHERE id=?`, id, now, workID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Cover(ctx context.Context, actor auth.User, id string) ([]byte, string, error) {
	var data []byte
	var contentType string
	err := s.db.QueryRowContext(ctx, `SELECT c.image_data,c.image_type FROM work_covers c JOIN works w ON w.id=c.work_id WHERE c.id=? AND c.image_data IS NOT NULL AND `+auth.EffectiveLibraryAccessSQL("w.library_id"), append([]any{id}, auth.LibraryAccessArgs(actor)...)...).Scan(&data, &contentType)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	return data, contentType, err
}

func (s *Store) editableWork(ctx context.Context, actor auth.User, workID string) (Work, error) {
	var work Work
	err := s.db.QueryRowContext(ctx, `SELECT w.id,w.library_id,w.title,COALESCE(w.author,'') FROM works w LEFT JOIN library_members m ON m.library_id=w.library_id AND m.user_id=? WHERE w.id=? AND (? OR m.role IN ('owner','editor'))`, actor.ID, workID, actor.Admin).Scan(&work.ID, &work.LibraryID, &work.Title, &work.Author)
	if errors.Is(err, sql.ErrNoRows) {
		return Work{}, ErrNotFound
	}
	return work, err
}

func openLibraryCoverURL(sourceID string) string {
	return "https://covers.openlibrary.org/b/id/" + sourceID + "-L.jpg?default=false"
}

func coverSourceLabel(source string) string {
	switch source {
	case "embedded":
		return "Embedded artwork"
	case "upload":
		return "Uploaded image"
	default:
		return "Open Library"
	}
}
