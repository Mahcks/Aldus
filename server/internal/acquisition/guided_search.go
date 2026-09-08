package acquisition

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/mahcks/aldus/server/internal/auth"
)

// Only an explicit numbered series prefix followed by a separator is removable.
// Bare numbers (1984), subtitles, and unnumbered series names remain untouched.
var numberedSeriesPrefix = regexp.MustCompile(`(?i)^([\pL][\pL\pN\s'’.,&-]*?)\s+(?:(?:book|volume|vol\.?|part)\s+)?([1-9][0-9]*)\s*[-–—:]\s*(.+)$`)

func seriesBookTitle(title string) (string, string) {
	parts := numberedSeriesPrefix.FindStringSubmatch(strings.TrimSpace(title))
	if parts == nil || len(releaseWords(parts[3])) < 2 {
		return "", ""
	}
	return strings.TrimSpace(parts[3]), parts[2]
}

func (s *TitleRequestStore) searchGuidedClaim(ctx context.Context, actor auth.User, claim claimedTitleFormat, policy guidedPolicy, blocked map[string]bool) (Request, []SearchResult, error) {
	titles := []string{claim.title}
	bookTitle, volume := seriesBookTitle(claim.title)
	if bookTitle != "" && strings.TrimSpace(claim.author) != "" {
		titles = append(titles, bookTitle)
	}
	for index, title := range titles {
		if err := ctx.Err(); err != nil {
			return Request{}, nil, err
		}
		query := strings.TrimSpace(title + " " + claim.author)
		request, err := s.acquisitions.create(ctx, actor, claim.libraryID, claim.sourceID, query)
		if err != nil {
			return Request{}, nil, err
		}
		results, searchErr := s.acquisitions.search(ctx, actor, claim.libraryID, request.ID)
		if searchErr == nil {
			results = matchingGuidedResults(results, title, claim.format, policy)
			results = slices.DeleteFunc(results, func(result SearchResult) bool {
				if blocked[result.downloadURL] || blocked[magnetInfoHash(result.downloadURL)] {
					return true
				}
				return index > 0 && !matchesFallbackBook(result, bookTitle, claim.author, volume)
			})
			if len(results) > 0 {
				return request, results, nil
			}
		}
		// A failed/empty search has no submission to preserve. Keep only the attempt
		// whose persisted results will be selected, under the existing claim guard.
		if _, err := s.db.ExecContext(ctx, `DELETE FROM acquisition_requests WHERE id=?`, request.ID); err != nil {
			return Request{}, nil, fmt.Errorf("discard unselected guided search: %w", err)
		}
		if searchErr != nil {
			return Request{}, nil, searchErr
		}
	}
	return Request{}, nil, nil
}

func matchesFallbackBook(result SearchResult, title, author, volume string) bool {
	// Validate raw release identity, not metadata that might have been enriched
	// from a merely related search hit. Missing author evidence fails closed.
	release := " " + normalizeWords(result.Title) + " "
	if !strings.Contains(release, " "+normalizeWords(title)+" ") ||
		!strings.Contains(release, " "+normalizeWords(author)+" ") {
		return false
	}
	if found := titleVolume(result.Title); found != "" && found != volume {
		return false
	}
	if _, found := seriesBookTitle(result.Title); found != "" && found != volume {
		return false
	}
	return true
}
