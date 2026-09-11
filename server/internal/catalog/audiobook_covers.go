package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/mahcks/aldus/server/internal/auth"
)

func (s *Store) SearchAudiobookCovers(ctx context.Context, actor auth.User, workID, query string) ([]CoverCandidate, error) {
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

	// Filter matching editions, not just works that happen to have an audio edition.
	query = "(" + query + `) AND (format:"Audio CD" OR format:"Audio Cassette" OR format:"Audiobook" OR format:"Digital Audio" OR format:"MP3 CD" OR format:"Audio" OR format:"Audio Book" OR format:"Audio Download")`
	parameters := url.Values{
		"q":      {query},
		"limit":  {"12"},
		"fields": {"key,title,author_name,editions,editions.key,editions.title,editions.cover_i,editions.format,editions.publisher,editions.isbn"},
	}
	response, err := openLibraryGET(ctx, openLibraryHTTPClient, "https://openlibrary.org/search.json?"+parameters.Encode())
	if err != nil {
		return nil, fmt.Errorf("search audiobook artwork: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("search audiobook artwork: unexpected status %d", response.StatusCode)
	}

	return parseAudiobookCovers(io.LimitReader(response.Body, 2<<20))
}

func parseAudiobookCovers(reader io.Reader) ([]CoverCandidate, error) {
	var result struct {
		Docs []struct {
			Authors  []string `json:"author_name"`
			Editions struct {
				Docs []struct {
					Title      string   `json:"title"`
					CoverID    int      `json:"cover_i"`
					Formats    []string `json:"format"`
					Publishers []string `json:"publisher"`
					ISBNs      []string `json:"isbn"`
				} `json:"docs"`
			} `json:"editions"`
		} `json:"docs"`
	}
	if err := json.NewDecoder(reader).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode audiobook artwork: %w", err)
	}

	candidates := make([]CoverCandidate, 0)
	seen := make(map[int]bool)
	for _, work := range result.Docs {
		for _, edition := range work.Editions.Docs {
			audio := false
			for _, format := range edition.Formats {
				switch strings.ToLower(strings.TrimSpace(format)) {
				case "audio cd", "audio cassette", "audiobook", "digital audio", "mp3 cd", "audio", "audio book", "audio download":
					audio = true
				}
			}
			if !audio || edition.CoverID <= 0 || seen[edition.CoverID] {
				continue
			}

			seen[edition.CoverID] = true
			id := strconv.Itoa(edition.CoverID)
			candidate := CoverCandidate{
				Source:   "open_library",
				SourceID: id,
				ImageURL: openLibraryCoverURL(id),
				Title:    edition.Title,
			}
			if len(work.Authors) > 0 {
				candidate.Author = work.Authors[0]
			}
			if len(edition.Publishers) > 0 {
				candidate.Publisher = edition.Publishers[0]
			}
			if len(edition.ISBNs) > 0 {
				candidate.ISBN = edition.ISBNs[0]
			}
			candidates = append(candidates, candidate)
		}
	}

	return candidates, nil
}
