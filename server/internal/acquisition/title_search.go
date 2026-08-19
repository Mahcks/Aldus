package acquisition

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
)

type TitleSearchResult struct {
	WorkID, LibraryID, Title, Author, CoverURL string
	ExternalSource, ExternalID                 string
	Readable, Listenable, Synchronized         bool
	EbookRequestState, AudiobookRequestState   string
}

type titleRequestProjection struct {
	WorkID, ExternalSource, ExternalID, Title, Author, CoverURL, Format, State string
}

func (s *Store) SearchTitles(ctx context.Context, actor auth.User, query string) ([]TitleSearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" || len(query) > 200 {
		return nil, ErrInvalid
	}
	var metadata []Metadata
	if s.client != nil {
		metadata = s.searchMetadata(ctx, s.client, query)
	}
	return s.searchTitles(ctx, actor, query, metadata)
}

func (s *Store) searchTitles(ctx context.Context, actor auth.User, query string, metadata []Metadata) ([]TitleSearchResult, error) {
	works, _, err := catalog.New(s.db).BrowseWorks(ctx, actor, catalog.BrowseOptions{Query: query, Sort: "title", Limit: 50})
	if err != nil {
		return nil, fmt.Errorf("search local titles: %w", err)
	}
	requests, err := s.searchTitleRequestStates(ctx, actor, query)
	if err != nil {
		return nil, err
	}
	results := make([]TitleSearchResult, 0, len(works)+len(metadata))
	for _, work := range works {
		results = append(results, TitleSearchResult{WorkID: work.ID, LibraryID: work.LibraryID, Title: work.Title, Author: work.Author, CoverURL: work.CoverURL, Readable: work.Readable, Listenable: work.Listenable, Synchronized: work.Synchronized})
	}

	for _, request := range requests {
		if request.WorkID == "" {
			continue
		}
		for i := range results {
			if results[i].WorkID == request.WorkID {
				applyRequestState(&results[i], request)
				if results[i].ExternalID == "" && request.ExternalID != "" {
					results[i].ExternalSource, results[i].ExternalID = request.ExternalSource, request.ExternalID
				}
			}
		}
	}

	externalCounts := make(map[string]int)
	for _, value := range metadata {
		externalCounts[exactTitleKey(value.Title, value.Author)]++
	}
	for _, value := range metadata {
		candidate := TitleSearchResult{Title: value.Title, Author: value.Author, CoverURL: value.CoverURL, ExternalSource: "open_library", ExternalID: value.ID}
		match := -1
		if value.ID != "" {
			for i := range results {
				if results[i].ExternalSource == "open_library" && results[i].ExternalID == value.ID {
					match = i
					break
				}
			}
		}
		key := exactTitleKey(value.Title, value.Author)
		if match < 0 && externalCounts[key] == 1 {
			for i := range results {
				if exactTitleKey(results[i].Title, results[i].Author) != key || results[i].ExternalID != "" {
					continue
				}
				if match >= 0 {
					match = -1
					break
				}
				match = i
			}
		}
		if match < 0 {
			results = append(results, candidate)
			match = len(results) - 1
		} else {
			results[match].ExternalSource, results[match].ExternalID = candidate.ExternalSource, candidate.ExternalID
			if results[match].CoverURL == "" {
				results[match].CoverURL = candidate.CoverURL
			}
		}
		for _, request := range requests {
			if request.ExternalSource == "open_library" && request.ExternalID == value.ID {
				applyRequestState(&results[match], request)
			}
		}
	}

	for _, request := range requests {
		match := -1
		for i := range results {
			if request.ExternalID != "" && results[i].ExternalSource == request.ExternalSource && results[i].ExternalID == request.ExternalID || request.WorkID != "" && results[i].WorkID == request.WorkID {
				match = i
				break
			}
		}
		if match < 0 {
			key := exactTitleKey(request.Title, request.Author)
			for i := range results {
				if exactTitleKey(results[i].Title, results[i].Author) == key {
					if match >= 0 {
						match = -1
						break
					}
					match = i
				}
			}
		}
		if match < 0 {
			results = append(results, TitleSearchResult{WorkID: request.WorkID, Title: request.Title, Author: request.Author, CoverURL: request.CoverURL, ExternalSource: request.ExternalSource, ExternalID: request.ExternalID})
			match = len(results) - 1
		}
		applyRequestState(&results[match], request)
	}
	return results, nil
}

func (s *Store) searchTitleRequestStates(ctx context.Context, actor auth.User, query string) ([]titleRequestProjection, error) {
	pattern := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.ToLower(query)) + "%"
	rows, err := s.db.QueryContext(ctx, `SELECT COALESCE(r.work_id,''),r.external_source,r.external_id,r.title,r.author,r.cover_url,f.format,f.state FROM title_requests r JOIN title_request_formats f ON f.title_request_id=r.id LEFT JOIN library_members m ON m.library_id=r.library_id AND m.user_id=? WHERE (r.requested_by=? OR ? OR m.role IN ('owner','editor')) AND (lower(r.title) LIKE ? ESCAPE '\' OR lower(r.author) LIKE ? ESCAPE '\') ORDER BY r.updated_at DESC,r.id,f.format`, actor.ID, actor.ID, actor.Admin, pattern, pattern)
	if err != nil {
		return nil, fmt.Errorf("search title request states: %w", err)
	}
	defer rows.Close()
	var values []titleRequestProjection
	for rows.Next() {
		var value titleRequestProjection
		if err := rows.Scan(&value.WorkID, &value.ExternalSource, &value.ExternalID, &value.Title, &value.Author, &value.CoverURL, &value.Format, &value.State); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

func applyRequestState(result *TitleSearchResult, request titleRequestProjection) {
	if request.Format == "ebook" && result.EbookRequestState == "" {
		result.EbookRequestState = request.State
	}
	if request.Format == "audiobook" && result.AudiobookRequestState == "" {
		result.AudiobookRequestState = request.State
	}
}

func exactTitleKey(title, author string) string {
	normalize := func(value string) string {
		return strings.Join(strings.FieldsFunc(strings.ToLower(value), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }), " ")
	}
	return normalize(title) + "\x00" + normalize(author)
}
