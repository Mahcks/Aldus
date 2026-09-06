package acquisition

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
)

// nytLists are the Best Sellers lists Aldus surfaces on Discover when an
// admin has configured an NYT API key. Kept short: the free NYT tier is
// limited to 1,000 requests/day and each list is its own request, so a
// long-TTL cache (see nytBestsellers) plus a small, fixed set of lists keeps
// Aldus well under that regardless of how many people check Discover.
var nytLists = []struct {
	Encoded string
	Title   string
}{
	{"hardcover-fiction", "Fiction"},
	{"hardcover-nonfiction", "Nonfiction"},
	{"young-adult-hardcover", "Young Adult"},
}

// TrendingSection groups trending titles from one source (Open Library's
// community trending feed, or a single NYT Best Sellers list) for the
// Discover screen's "not searching" browse view.
type TrendingSection struct {
	Source string
	Title  string
	Items  []TitleSearchResult
}

type trendingItem struct {
	Title          string
	Author         string
	CoverURL       string
	ExternalSource string
	ExternalID     string
}

type cachedTrending struct {
	value   []trendingItem
	expires time.Time
}

type cachedDescription struct {
	value   string
	expires time.Time
	err     error
}

// Trending returns what's popular to read right now: Open Library's
// trending feed is always included; NYT Best Sellers lists light up once an
// admin configures an API key. Each item is annotated against the caller's
// own library and existing requests, exactly like SearchTitles does, so
// Discover can render trending titles with the same "already have this" /
// request-state treatment as a text search.
func (s *Store) Trending(ctx context.Context, actor auth.User, libraryID ...string) ([]TrendingSection, error) {
	selectedLibrary := ""
	if len(libraryID) > 0 {
		selectedLibrary = strings.TrimSpace(libraryID[0])
	}
	catalogIndex, err := s.trendingCatalogIndex(ctx, actor, selectedLibrary)
	if err != nil {
		return nil, err
	}
	requests, err := s.searchTitleRequestStates(ctx, actor, "", selectedLibrary)
	if err != nil {
		return nil, err
	}

	var sections []TrendingSection
	if items := s.openLibraryTrending(ctx); len(items) > 0 {
		sections = append(sections, TrendingSection{
			Source: "open_library",
			Title:  "Trending this week",
			Items:  matchTrendingItems(items, catalogIndex, requests),
		})
	}

	options, err := s.options(ctx)
	if err != nil {
		return nil, err
	}
	if options.NYTAPIKey != "" {
		for _, list := range nytLists {
			items := s.nytBestsellers(ctx, options.NYTAPIKey, list.Encoded)
			if len(items) == 0 {
				continue
			}
			sections = append(sections, TrendingSection{
				Source: "nyt_" + list.Encoded,
				Title:  "NYT Best Sellers · " + list.Title,
				Items:  matchTrendingItems(items, catalogIndex, requests),
			})
		}
	}
	return sections, nil
}

// Detail returns a longer description for a not-yet-owned Discover result,
// fetched on demand so a "view more about this book" tap stays cheap —
// unlike Trending and SearchTitles, this is never called for a whole list at
// once. Only Open Library results carry a description today.
func (s *Store) Detail(ctx context.Context, source, id string) (string, error) {
	if source != "open_library" || id == "" || s.client == nil {
		return "", ErrInvalid
	}
	s.descriptionMu.Lock()
	if cached, ok := s.descriptionCache[id]; ok && time.Now().Before(cached.expires) {
		s.descriptionMu.Unlock()
		return cached.value, cached.err
	}
	s.descriptionMu.Unlock()

	value, err := s.client.workDescription(ctx, id)
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	ttl := 30 * time.Minute
	if err != nil {
		ttl = time.Minute
	}
	s.descriptionMu.Lock()
	if len(s.descriptionCache) >= 128 {
		clear(s.descriptionCache)
	}
	s.descriptionCache[id] = cachedDescription{value: value, expires: time.Now().Add(ttl), err: err}
	s.descriptionMu.Unlock()
	return value, err
}

func (s *Store) trendingCatalogIndex(ctx context.Context, actor auth.User, libraryID string) (map[string]TitleSearchResult, error) {
	index := make(map[string]TitleSearchResult)
	store := catalog.New(s.db)
	for offset := 0; ; {
		works, more, err := store.BrowseWorks(ctx, actor, catalog.BrowseOptions{LibraryID: libraryID, Sort: "title", Limit: 100, Offset: offset})
		if err != nil {
			return nil, fmt.Errorf("browse local catalog for trending: %w", err)
		}
		for _, work := range works {
			index[exactTitleKey(work.Title, work.Author)] = TitleSearchResult{
				WorkID: work.ID, LibraryID: work.LibraryID, Title: work.Title, Author: work.Author,
				CoverURL: work.CoverURL, Readable: work.Readable, Listenable: work.Listenable, Synchronized: work.Synchronized,
			}
		}
		if !more || len(works) == 0 {
			break
		}
		offset += len(works)
	}

	return index, nil
}

// matchTrendingItems mirrors searchTitles' own exact-title-key matching
// (see title_search.go) so a trending title already in the library, or
// already requested, shows the same state a text search for it would.
func matchTrendingItems(items []trendingItem, catalogIndex map[string]TitleSearchResult, requests []titleRequestProjection) []TitleSearchResult {
	results := make([]TitleSearchResult, 0, len(items))
	for _, item := range items {
		key := exactTitleKey(item.Title, item.Author)
		result, owned := catalogIndex[key]
		if !owned {
			result = TitleSearchResult{Title: item.Title, Author: item.Author, CoverURL: item.CoverURL, ExternalSource: item.ExternalSource, ExternalID: item.ExternalID}
		}
		for _, request := range requests {
			if exactTitleKey(request.Title, request.Author) == key {
				applyRequestState(&result, request)
			}
		}
		results = append(results, result)
	}
	return results
}

func (s *Store) openLibraryTrending(ctx context.Context) []trendingItem {
	const cacheKey = "open_library"
	if cached, ok := s.readTrendingCache(cacheKey); ok {
		return cached
	}
	if s.client == nil {
		return nil
	}
	value, err := openLibraryTrendingFrom(ctx, s.client.http, "https://openlibrary.org/trending/weekly.json?limit=20")
	if ctx.Err() != nil {
		return nil
	}
	if err != nil {
		slog.WarnContext(ctx, "open library trending unavailable", "error", err)
	}
	s.writeTrendingCache(cacheKey, value, err)
	return value
}

func (s *Store) nytBestsellers(ctx context.Context, apiKey, list string) []trendingItem {
	cacheKey := fmt.Sprintf("nyt_%s_%x", list, sha256.Sum256([]byte(apiKey)))
	if cached, ok := s.readTrendingCache(cacheKey); ok {
		return cached
	}
	if s.client == nil {
		return nil
	}
	endpoint := "https://api.nytimes.com/svc/books/v3/lists/current/" + url.PathEscape(list) + ".json?api-key=" + url.QueryEscape(apiKey)
	value, err := nytBestsellersFrom(ctx, s.client.http, endpoint)
	if ctx.Err() != nil {
		return nil
	}
	if err != nil {
		slog.WarnContext(ctx, "nyt best sellers unavailable", "list", list, "error", err)
	} else if len(value) == 0 {
		slog.WarnContext(ctx, "nyt best sellers returned no books; response shape may not match this integration", "list", list)
	}
	s.writeTrendingCache(cacheKey, value, err)
	return value
}

func (s *Store) readTrendingCache(key string) ([]trendingItem, bool) {
	s.trendingMu.Lock()
	defer s.trendingMu.Unlock()
	cached, ok := s.trendingCache[key]
	if !ok || time.Now().After(cached.expires) {
		return nil, false
	}
	return cached.value, true
}

func (s *Store) writeTrendingCache(key string, value []trendingItem, err error) {
	ttl := 12 * time.Hour
	if err != nil {
		ttl = 5 * time.Minute
	}
	s.trendingMu.Lock()
	defer s.trendingMu.Unlock()
	if len(s.trendingCache) >= 16 {
		clear(s.trendingCache)
	}
	s.trendingCache[key] = cachedTrending{value: value, expires: time.Now().Add(ttl)}
}

func openLibraryTrendingFrom(ctx context.Context, client *http.Client, endpoint string) ([]trendingItem, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Aldus/dev (+https://github.com/mahcks/aldus)")
	response, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, ErrUnavailable
	}
	var payload struct {
		Works []struct {
			Key        string   `json:"key"`
			Title      string   `json:"title"`
			AuthorName []string `json:"author_name"`
			CoverID    int      `json:"cover_i"`
		} `json:"works"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&payload); err != nil {
		return nil, err
	}
	items := make([]trendingItem, 0, len(payload.Works))
	for _, work := range payload.Works {
		title := strings.TrimSpace(work.Title)
		if title == "" {
			continue
		}
		item := trendingItem{
			Title:          title,
			ExternalSource: "open_library",
			ExternalID:     strings.TrimPrefix(strings.TrimSpace(work.Key), "/works/"),
		}
		if len(work.AuthorName) > 0 {
			item.Author = strings.TrimSpace(work.AuthorName[0])
		}
		if work.CoverID > 0 {
			item.CoverURL = "https://covers.openlibrary.org/b/id/" + strconv.Itoa(work.CoverID) + "-M.jpg?default=false"
		}
		items = append(items, item)
	}
	return items, nil
}

// nytBestsellersFrom decodes the current NYT Books v3 list shape
// (results.books[]) and falls back to the older flat results[].book_details
// shape it also documents, since this integration can't be exercised
// end-to-end without a registered API key.
func nytBestsellersFrom(ctx context.Context, client *http.Client, endpoint string) ([]trendingItem, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(req)
	if err != nil {
		var urlError *url.Error
		if errors.As(err, &urlError) {
			return nil, urlError.Err
		}
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, ErrUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, err
	}

	var modern struct {
		Results struct {
			Books []struct {
				Title     string `json:"title"`
				Author    string `json:"author"`
				BookImage string `json:"book_image"`
			} `json:"books"`
		} `json:"results"`
	}
	if json.Unmarshal(body, &modern) == nil && len(modern.Results.Books) > 0 {
		items := make([]trendingItem, 0, len(modern.Results.Books))
		for _, book := range modern.Results.Books {
			title := strings.TrimSpace(book.Title)
			if title == "" {
				continue
			}
			items = append(items, trendingItem{Title: titleCase(title), Author: strings.TrimSpace(book.Author), CoverURL: strings.TrimSpace(book.BookImage)})
		}
		return items, nil
	}

	var legacy struct {
		Results []struct {
			BookDetails []struct {
				Title  string `json:"title"`
				Author string `json:"author"`
			} `json:"book_details"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &legacy); err != nil {
		return nil, err
	}
	items := make([]trendingItem, 0, len(legacy.Results))
	for _, entry := range legacy.Results {
		if len(entry.BookDetails) == 0 {
			continue
		}
		detail := entry.BookDetails[0]
		title := strings.TrimSpace(detail.Title)
		if title == "" {
			continue
		}
		items = append(items, trendingItem{Title: titleCase(title), Author: strings.TrimSpace(detail.Author)})
	}
	return items, nil
}

// titleCase turns NYT's all-caps titles ("THE ROAD") into readable ones
// ("The Road"). Open Library and the local catalog already carry natural
// casing, so only the NYT path calls this.
func titleCase(value string) string {
	words := strings.Fields(strings.ToLower(value))
	for i, word := range words {
		runes := []rune(word)
		if len(runes) > 0 {
			runes[0] = unicode.ToUpper(runes[0])
		}
		words[i] = string(runes)
	}
	return strings.Join(words, " ")
}
