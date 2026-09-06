package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

func (s *Store) SearchMetadata(ctx context.Context, actor auth.User, id, query string) (MetadataPreview, error) {
	current, err := s.MetadataCurrent(ctx, actor, id)
	if err != nil {
		return MetadataPreview{}, err
	}
	query = strings.TrimSpace(query)
	if query == "" {
		query = strings.TrimSpace(current.Title + " " + current.Author)
	}
	if len(query) > 200 {
		return MetadataPreview{}, ErrInvalid
	}
	candidates, err := searchMetadataCandidates(ctx, openLibraryHTTPClient, query)
	return MetadataPreview{Current: current, Candidates: candidates}, err
}

func (s *Store) MetadataEditions(ctx context.Context, actor auth.User, id, providerID, language, isbn string) (MetadataPreview, error) {
	current, err := s.MetadataCurrent(ctx, actor, id)
	if err != nil {
		return MetadataPreview{}, err
	}
	if !metadataWorkID.MatchString(providerID) || len(language) > 100 || len(isbn) > 100 {
		return MetadataPreview{}, ErrInvalid
	}
	candidates, err := metadataEditions(ctx, openLibraryHTTPClient, providerID, language, isbn)
	return MetadataPreview{Current: current, Candidates: candidates}, err
}

func metadataJSON(ctx context.Context, client *http.Client, path string, value any) error {
	// Only provider-owned HTTPS origins may be followed, including redirects.
	safe := *client
	safe.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 || req.URL.Scheme != "https" || req.URL.Host != "openlibrary.org" {
			return ErrMetadataUnavailable
		}
		return nil
	}
	response, err := openLibraryGET(ctx, &safe, "https://openlibrary.org"+path)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrMetadataUnavailable, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return ErrMetadataUnavailable
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(value); err != nil {
		return fmt.Errorf("%w: invalid response", ErrMetadataUnavailable)
	}
	return nil
}

func searchMetadataCandidates(ctx context.Context, client *http.Client, query string) ([]MetadataCandidate, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	var result openLibraryResult
	if err := metadataJSON(ctx, client, "/search.json?limit=12&fields=key,title,author_name,first_publish_year,cover_i&q="+url.QueryEscape(query), &result); err != nil {
		return nil, err
	}
	candidates := []MetadataCandidate{}
	seen := map[string]bool{}
	for _, doc := range result.Docs {
		id := strings.TrimPrefix(doc.Key, "/works/")
		if !metadataWorkID.MatchString(id) || strings.TrimSpace(doc.Title) == "" || seen[id] {
			continue
		}
		seen[id] = true
		value := MetadataValues{
			Title:            metadataText(doc.Title, 500),
			FirstPublishYear: validMetadataYear(doc.FirstPublishYear),
			Subjects:         []string{},
		}
		if len(doc.Authors) > 0 {
			value.Author = metadataText(strings.Join(doc.Authors, ", "), 500)
		}
		if doc.CoverID > 0 {
			value.CoverURL = openLibraryCoverURL(strconv.Itoa(doc.CoverID))
		}
		candidates = append(candidates, MetadataCandidate{WorkID: id, Values: value})
		if len(candidates) == 12 {
			break
		}
	}
	return candidates, nil
}

func validMetadataYear(year int) int {
	if year < 0 || year > 9999 {
		return 0
	}
	return year
}

var metadataYearPattern = regexp.MustCompile(`\b[0-9]{4}\b`)

func metadataEditions(ctx context.Context, client *http.Client, id, language, isbn string) ([]MetadataCandidate, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	base, err := loadMetadataTitle(ctx, client, id)
	if err != nil {
		return nil, err
	}

	var editions struct {
		Entries []metadataEditionRecord `json:"entries"`
	}
	// ponytail: bounded to 50 editions; add provider pagination when users need older printings.
	if err := metadataJSON(ctx, client, "/works/"+id+"/editions.json?limit=50", &editions); err != nil {
		return nil, err
	}
	candidates := []MetadataCandidate{{WorkID: id, Values: base}}
	seen := map[string]bool{}
	for _, entry := range editions.Entries {
		editionID := strings.TrimPrefix(entry.Key, "/books/")
		if !metadataEditionID.MatchString(editionID) || seen[editionID] {
			continue
		}
		seen[editionID] = true
		value := metadataEditionValues(base, entry)
		candidates = append(candidates, MetadataCandidate{WorkID: id, EditionID: editionID, Values: value})
		if len(candidates) == 51 {
			break
		}
	}
	score := func(value MetadataCandidate) int {
		score := 0
		if isbn != "" && value.Values.ISBN == isbn {
			score += 2
		}
		if language != "" && strings.EqualFold(value.Values.Language, language) {
			score++
		}
		return score
	}
	slices.SortStableFunc(candidates, func(a, b MetadataCandidate) int { return score(b) - score(a) })
	return candidates, nil
}

func loadMetadataTitle(ctx context.Context, client *http.Client, id string) (MetadataValues, error) {
	var work struct {
		FirstPublishDate string          `json:"first_publish_date"`
		Title            string          `json:"title"`
		Description      json.RawMessage `json:"description"`
		Subjects         []string        `json:"subjects"`
		Covers           []int           `json:"covers"`
		Authors          []struct {
			Author struct {
				Key string `json:"key"`
			} `json:"author"`
		} `json:"authors"`
	}
	if err := metadataJSON(ctx, client, "/works/"+id+".json", &work); err != nil {
		return MetadataValues{}, err
	}
	var description string
	if json.Unmarshal(work.Description, &description) != nil {
		var value struct {
			Value string `json:"value"`
		}
		_ = json.Unmarshal(work.Description, &value)
		description = value.Value
	}
	base := MetadataValues{
		Title:       metadataText(work.Title, 500),
		Description: metadataText(description, maxWorkDescriptionRunes),
		Subjects:    cleanOpenLibrarySubjects(work.Subjects),
	}
	year, _ := strconv.Atoi(metadataYearPattern.FindString(work.FirstPublishDate))
	base.FirstPublishYear = validMetadataYear(year)
	for i, subject := range base.Subjects {
		base.Subjects[i] = metadataText(subject, 200)
	}
	if len(work.Covers) > 0 && work.Covers[0] > 0 {
		base.CoverURL = openLibraryCoverURL(strconv.Itoa(work.Covers[0]))
	}
	// Author lookups are bounded; never follow arbitrary keys supplied by the provider.
	authors := []string{}
	for _, entry := range work.Authors[:min(len(work.Authors), 3)] {
		key := strings.TrimPrefix(entry.Author.Key, "/authors/")
		if !metadataAuthorID.MatchString(key) {
			continue
		}
		var author struct {
			Name string `json:"name"`
		}
		if err := metadataJSON(ctx, client, "/authors/"+key+".json", &author); err != nil {
			return MetadataValues{}, err
		}
		if author.Name != "" {
			authors = append(authors, author.Name)
		}
	}
	base.Author = metadataText(strings.Join(authors, ", "), 500)
	return base, nil
}

type metadataEditionRecord struct {
	Key        string   `json:"key"`
	Title      string   `json:"title"`
	Publishers []string `json:"publishers"`
	ISBN13     []string `json:"isbn_13"`
	ISBN10     []string `json:"isbn_10"`
	Languages  []struct {
		Key string `json:"key"`
	} `json:"languages"`
	Covers []int `json:"covers"`
}

func metadataEditionValues(base MetadataValues, entry metadataEditionRecord) MetadataValues {
	value := base
	if entry.Title != "" {
		value.Title = metadataText(entry.Title, 500)
	}
	if len(entry.Publishers) > 0 {
		value.Publisher = metadataText(entry.Publishers[0], 500)
	}
	if len(entry.ISBN13) > 0 {
		value.ISBN = metadataText(entry.ISBN13[0], 100)
	} else if len(entry.ISBN10) > 0 {
		value.ISBN = metadataText(entry.ISBN10[0], 100)
	}
	languages := []string{}
	for _, tag := range entry.Languages {
		languages = append(languages, strings.TrimPrefix(tag.Key, "/languages/"))
	}
	value.Language = metadataText(strings.Join(languages, ", "), 100)
	if len(entry.Covers) > 0 && entry.Covers[0] > 0 {
		value.CoverURL = openLibraryCoverURL(strconv.Itoa(entry.Covers[0]))
	}
	return value
}
