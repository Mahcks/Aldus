package acquisition

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"
)

const maxSearchResults = 80

var (
	bracketedMetadata = regexp.MustCompile(`\[[^]]*\]|\([^)]*\)|\{[^}]*\}`)
	yearToken         = regexp.MustCompile(`\b(?:19|20)\d{2}\b`)
	byAuthor          = regexp.MustCompile(`(?i)\s+by\s+([\pL][\pL.'-]*(?:\s+[\pL][\pL.'-]*){0,4})`)
	narratedBy        = regexp.MustCompile(`(?i)\b(?:narrated|read)\s+by\s+([\pL][\pL.'-]*(?:\s+[\pL][\pL.'-]*){0,4})`)
)

var releaseFormats = map[string]string{
	"epub": "EPUB", "mobi": "MOBI", "azw3": "AZW3", "pdf": "PDF", "cbz": "CBZ", "cbr": "CBR",
	"audiobook": "Audiobook", "mp3": "MP3", "m4a": "M4A", "m4b": "M4B",
	"aac": "AAC", "flac": "FLAC", "ogg": "OGG", "opus": "OPUS", "wav": "WAV",
}

// Formats read visually rather than listened to — everything else in
// releaseFormats defaults to "audiobook". Comics (CBZ/CBR) and other ebook
// containers (MOBI/AZW3/PDF) belong here, or a release using them gets
// silently misclassified as an audiobook.
var ebookFormats = map[string]bool{
	"epub": true, "mobi": true, "azw3": true, "pdf": true, "cbz": true, "cbr": true,
}

var metadataWords = map[string]bool{
	"epub": true, "mobi": true, "azw3": true, "pdf": true, "cbz": true, "cbr": true,
	"audiobook": true, "mp3": true, "m4a": true, "m4b": true, "aac": true,
	"flac": true, "ogg": true, "opus": true, "wav": true, "retail": true, "repack": true,
	"unabridged": true, "abridged": true,
}

var derivativePhrases = []string{
	"unofficial", "official companion", "companion", "cookbook", "recipes", "knitting", "knits",
	"coloring", "colouring", "cliffsnotes", "cliff notes", "study guide", "sparknotes", "philosophy",
	"strategy", "board game", "battle game", "trivia", "quiz", "sheet music", "soundtrack", "explains", "hidden meaning",
}

type discoveryResult struct {
	Result
	CanonicalTitle, Author, Language, Format, Kind, Edition, Narrator, GroupKey, Match string
	Relevance                                                                          int
}

const workTitleSimilarity = 0.7

func normalizeSearchResults(query string, results []Result) []discoveryResult {
	results = slices.Clone(results)
	slices.SortStableFunc(results, func(a, b Result) int {
		if compared := strings.Compare(normalizeWords(a.Title), normalizeWords(b.Title)); compared != 0 {
			return compared
		}
		if a.Size != b.Size {
			if a.Size < b.Size {
				return -1
			}
			return 1
		}
		if compared := strings.Compare(strings.ToLower(a.Source), strings.ToLower(b.Source)); compared != 0 {
			return compared
		}
		return strings.Compare(a.DownloadURL, b.DownloadURL)
	})
	seen := make(map[string]bool, len(results))
	values := make([]discoveryResult, 0, min(len(results), maxSearchResults))
	for _, result := range results {
		value := parseDiscoveryResult(query, result)
		if value.CanonicalTitle == "" || value.Format == "" {
			continue
		}
		key := normalizeWords(result.Title) + "\x00" + strconv.FormatInt(max(0, result.Size), 10)
		if seen[key] {
			continue
		}
		seen[key] = true
		values = append(values, value)
	}
	slices.SortStableFunc(values, func(a, b discoveryResult) int {
		if a.Relevance != b.Relevance {
			return b.Relevance - a.Relevance
		}
		if compared := strings.Compare(a.CanonicalTitle, b.CanonicalTitle); compared != 0 {
			return compared
		}
		return strings.Compare(a.Format, b.Format)
	})
	assignGroupKeys(values)
	return values[:min(len(values), maxSearchResults)]
}

func parseDiscoveryResult(query string, result Result) discoveryResult {
	raw := strings.TrimSpace(result.Title)
	words := releaseWords(raw)
	format := ""
	for _, word := range words {
		if label := releaseFormats[strings.ToLower(word)]; label != "" {
			format = label
			break
		}
	}
	kind := "audiobook"
	if ebookFormats[strings.ToLower(format)] {
		kind = "ebook"
	}
	language := ""
	for _, word := range words {
		switch strings.ToLower(word) {
		case "eng", "english":
			language = "en"
		case "spa", "spanish":
			language = "es"
		case "fre", "fra", "french":
			language = "fr"
		case "ger", "deu", "german":
			language = "de"
		}
	}
	narrator := submatch(narratedBy, raw)
	author := submatch(byAuthor, raw)
	remainder := bracketedMetadata.ReplaceAllString(raw, " ")
	if narrator != "" {
		remainder = narratedBy.ReplaceAllString(remainder, " ")
	}
	if author != "" {
		if match := byAuthor.FindStringIndex(remainder); match != nil {
			remainder = remainder[:match[0]] + remainder[match[1]:]
		}
	} else if before, after, ok := strings.Cut(remainder, " - "); ok && plausibleName(before) {
		author, remainder = strings.TrimSpace(before), after
	}
	edition := ""
	lower := strings.ToLower(raw)
	if strings.Contains(lower, "unabridged") {
		edition = "Unabridged"
	} else if strings.Contains(lower, "abridged") {
		edition = "Abridged"
	}
	canonical := cleanReleaseTitle(remainder)
	relevance := relevanceScore(query, canonical)
	match := "related"
	if comparableTitle(query) == comparableTitle(canonical) {
		match = "exact"
	}
	return discoveryResult{Result: result, CanonicalTitle: canonical, Author: author, Language: language, Format: format, Kind: kind, Edition: edition, Narrator: narrator, Match: match, Relevance: relevance}
}

func assignGroupKeys(results []discoveryResult) {
	parents := make([]int, len(results))
	for i := range parents {
		parents[i] = i
	}
	var find func(int) int
	find = func(value int) int {
		if parents[value] != value {
			parents[value] = find(parents[value])
		}
		return parents[value]
	}
	for i := range results {
		for j := i + 1; j < len(results); j++ {
			if sameWork(results[i].CanonicalTitle, results[i].Author, results[j].CanonicalTitle, results[j].Author) {
				parents[find(j)] = find(i)
			}
		}
	}
	members := make(map[int][]string, len(results))
	for i, result := range results {
		root := find(i)
		members[root] = append(members[root], normalizeWords(result.CanonicalTitle)+"\x00"+normalizeWords(result.Author))
	}
	keys := make(map[int]string, len(members))
	for root, identities := range members {
		slices.Sort(identities)
		sum := sha256.Sum256([]byte(strings.Join(identities, "\x01")))
		keys[root] = hex.EncodeToString(sum[:8])
	}
	for i := range results {
		results[i].GroupKey = keys[find(i)]
	}
}

func sameWork(titleA, authorA, titleB, authorB string) bool {
	if derivativeKind(titleA) != derivativeKind(titleB) || !sameWorkTitle(titleA, titleB) {
		return false
	}
	return authorA == "" || authorB == "" || titleSimilarity(normalizedWords(authorA), normalizedWords(authorB)) >= .8
}

func sameWorkTitle(a, b string) bool {
	return titleSimilarity(normalizedWords(comparableTitle(a)), normalizedWords(comparableTitle(b))) >= workTitleSimilarity
}

func derivativeKind(title string) string {
	title = normalizeWords(title)
	for _, phrase := range derivativePhrases {
		if phrase != "unofficial" && strings.Contains(title, phrase) {
			return phrase
		}
	}
	return ""
}

func releaseWords(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
}

func cleanReleaseTitle(value string) string {
	value = yearToken.ReplaceAllString(value, " ")
	kept := make([]string, 0)
	for _, word := range releaseWords(value) {
		if !metadataWords[strings.ToLower(word)] {
			kept = append(kept, word)
		}
	}
	return strings.TrimSpace(strings.Join(kept, " "))
}

func normalizeWords(value string) string {
	return strings.ToLower(strings.Join(releaseWords(value), " "))
}

func comparableTitle(value string) string {
	value = normalizeWords(value)
	for _, article := range []string{"the ", "a ", "an "} {
		if strings.HasPrefix(value, article) {
			return strings.TrimPrefix(value, article)
		}
	}
	return value
}

func relevanceScore(query, title string) int {
	query, title = comparableTitle(query), comparableTitle(title)
	if query == "" || title == "" {
		return 0
	}
	score := 0
	switch {
	case title == query:
		score = 100
	case strings.HasPrefix(title, query):
		score = 60
	case strings.Contains(title, query):
		score = 30
	default:
		for _, word := range strings.Fields(query) {
			if strings.Contains(" "+title+" ", " "+word+" ") {
				score += 20 / max(1, len(strings.Fields(query)))
			}
		}
	}
	score -= max(0, len(strings.Fields(title))-len(strings.Fields(query))) * 2
	for _, phrase := range derivativePhrases {
		if strings.Contains(title, phrase) {
			score -= 45
		}
	}
	return score
}

func submatch(expression *regexp.Regexp, value string) string {
	match := expression.FindStringSubmatch(value)
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(match[1])
}

func plausibleName(value string) bool {
	words := strings.Fields(strings.TrimSpace(value))
	return len(words) >= 2 && len(words) <= 5
}
