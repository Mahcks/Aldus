package acquisition

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
)

type Metadata struct {
	ID, Title, Author, ISBN, CoverURL string
	Year                              int
}

type cachedMetadata struct {
	value   []Metadata
	expires time.Time
}

func (s *Store) searchMetadata(ctx context.Context, client *Client, query string) []Metadata {
	key := strings.Join(normalizedWords(query), " ")
	s.metadataMu.Lock()
	if cached, ok := s.metadataCache[key]; ok && time.Now().Before(cached.expires) {
		s.metadataMu.Unlock()
		return cached.value
	}
	s.metadataMu.Unlock()

	value, err := client.metadata(ctx, query)
	ttl := 30 * time.Minute
	if err != nil {
		ttl = time.Minute
	}
	s.metadataMu.Lock()
	if len(s.metadataCache) >= 64 {
		clear(s.metadataCache)
	}
	s.metadataCache[key] = cachedMetadata{value: value, expires: time.Now().Add(ttl)}
	s.metadataMu.Unlock()
	return value
}

func (c *Client) metadata(ctx context.Context, query string) ([]Metadata, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	endpoint := "https://openlibrary.org/search.json?limit=10&fields=key,cover_i,title,author_name,first_publish_year,isbn&q=" + url.QueryEscape(query)
	return metadataFrom(ctx, c.http, endpoint, query)
}

func metadataFrom(ctx context.Context, client *http.Client, endpoint, query string) ([]Metadata, error) {
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
		Docs []struct {
			Key     string   `json:"key"`
			CoverID int      `json:"cover_i"`
			Title   string   `json:"title"`
			Authors []string `json:"author_name"`
			Year    int      `json:"first_publish_year"`
			ISBNs   []string `json:"isbn"`
		} `json:"docs"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&payload); err != nil {
		return nil, err
	}
	queryKey := normalizedWords(query)
	values := make([]Metadata, 0, len(payload.Docs))
	for _, doc := range payload.Docs {
		if titleSimilarity(queryKey, normalizedWords(doc.Title)) < 0.5 {
			continue
		}
		result := Metadata{ID: strings.TrimPrefix(strings.TrimSpace(doc.Key), "/works/"), Title: strings.TrimSpace(doc.Title), Year: doc.Year}
		if len(doc.Authors) > 0 {
			result.Author = strings.TrimSpace(doc.Authors[0])
		}
		if len(doc.ISBNs) > 0 {
			result.ISBN = strings.TrimSpace(doc.ISBNs[0])
		}
		if doc.CoverID > 0 {
			result.CoverURL = "https://covers.openlibrary.org/b/id/" + strconv.Itoa(doc.CoverID) + "-M.jpg?default=false"
		}
		values = append(values, result)
	}
	return values, nil
}

func matchingMetadata(title, author string, values []Metadata) Metadata {
	bestScore := 0.0
	var best Metadata
	for _, value := range values {
		if !sameCanonicalTitle(title, value.Title) || author != "" && value.Author != "" && titleSimilarity(normalizedWords(author), normalizedWords(value.Author)) < .8 {
			continue
		}
		score := titleSimilarity(normalizedWords(title), normalizedWords(value.Title))
		if score > bestScore || score == bestScore && best.CoverURL == "" && value.CoverURL != "" {
			bestScore, best = score, value
		}
	}
	return best
}

func releaseMetadata(raw string) (title, author, format, language string, abridged bool) {
	lower := strings.ToLower(raw)
	for _, candidate := range []string{"epub", "m4b", "mp3", "m4a", "flac", "aac", "ogg", "opus", "wav", "audiobook"} {
		if containsWord(lower, candidate) {
			format = strings.ToUpper(candidate)
			break
		}
	}
	for code, names := range map[string][]string{"en": {"eng", "english"}, "de": {"ger", "german", "deu"}, "es": {"spa", "spanish"}, "fr": {"fre", "french", "fra"}} {
		for _, name := range names {
			if containsWord(lower, name) {
				language = code
			}
		}
	}
	abridged = containsWord(lower, "abridged") && !containsWord(lower, "unabridged")
	clean := raw
	if at := strings.Index(strings.ToLower(clean), " by "); at > 0 {
		title, author = clean[:at], clean[at+4:]
	} else if at := strings.Index(clean, " - "); at > 0 {
		author, title = clean[:at], clean[at+3:]
	} else {
		title = clean
	}
	title = cleanReleasePart(title)
	author = cleanReleasePart(author)
	return
}

func pairScore(a, b SearchResult) (int, []string) {
	if a.Format == "" || b.Format == "" || isAudio(a.Format) == isAudio(b.Format) {
		return 0, nil
	}
	if !sameCanonicalTitle(a.CanonicalTitle, b.CanonicalTitle) {
		return 0, nil
	}
	score := 70
	reasons := []string{"Titles match"}
	if a.Author != "" && b.Author != "" {
		if titleSimilarity(normalizedWords(a.Author), normalizedWords(b.Author)) < .8 {
			return 0, nil
		}
		score += 20
		reasons = append(reasons, "Authors match")
	}
	if a.Language != "" && b.Language != "" {
		if a.Language != b.Language {
			return 0, nil
		}
		score += 10
		reasons = append(reasons, "Languages match")
	}
	if a.Abridged || b.Abridged {
		return 0, nil
	}
	return score, reasons
}

func sameCanonicalTitle(a, b string) bool {
	return derivativeKind(a) == derivativeKind(b) && sameWorkTitle(a, b)
}

func addLikelyPairs(results []SearchResult) {
	for i := range results {
		for j := i + 1; j < len(results); j++ {
			score, reasons := pairScore(results[i], results[j])
			if score < 70 {
				continue
			}
			results[i].LikelyPairIDs = append(results[i].LikelyPairIDs, results[j].ID)
			results[j].LikelyPairIDs = append(results[j].LikelyPairIDs, results[i].ID)
			results[i].MatchConfidence, results[j].MatchConfidence = "likely", "likely"
			results[i].MatchReasons = appendUnique(results[i].MatchReasons, reasons...)
			results[j].MatchReasons = appendUnique(results[j].MatchReasons, reasons...)
		}
	}
}

func isAudio(format string) bool { return format != "" && !ebookFormats[strings.ToLower(format)] }

func normalizedWords(value string) []string {
	words := strings.FieldsFunc(strings.ToLower(value), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	slices.Sort(words)
	return slices.Compact(words)
}

func titleSimilarity(a, b []string) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	common := 0
	for _, word := range a {
		if slices.Contains(b, word) {
			common++
		}
	}
	return float64(2*common) / float64(len(a)+len(b))
}

func cleanReleasePart(value string) string {
	words := strings.FieldsFunc(value, func(r rune) bool { return !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '\'' || r == '-') })
	kept := words[:0]
	for _, word := range words {
		lower := strings.ToLower(word)
		if containsWord("epub m4b mp3 m4a flac aac ogg opus wav audiobook unabridged abridged retail", lower) || len(word) == 4 && word[0] >= '0' && word[0] <= '9' {
			continue
		}
		kept = append(kept, word)
	}
	return strings.TrimSpace(strings.Join(kept, " "))
}

func containsWord(value, word string) bool {
	for _, candidate := range strings.FieldsFunc(value, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if candidate == word {
			return true
		}
	}
	return false
}

func appendUnique(values []string, additions ...string) []string {
	for _, value := range additions {
		if !slices.Contains(values, value) {
			values = append(values, value)
		}
	}
	return values
}
