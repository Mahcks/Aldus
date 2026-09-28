package acquisition

import (
	"context"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
)

// localDiscoverySections uses the most recently opened book as an explicit reason
// for suggestions. It does not infer a reader's tastes or availability outside Aldus.
func (s *Store) localDiscoverySections(ctx context.Context, actor auth.User, libraryID string) ([]TrendingSection, error) {
	store := catalog.New(s.db)
	seeds, _, err := store.BrowseWorks(ctx, actor, catalog.BrowseOptions{LibraryID: libraryID, Availability: "in_progress", Sort: "progress", Limit: 1})
	if err != nil || len(seeds) == 0 {
		return nil, err
	}
	seed := seeds[0]
	var sections []TrendingSection
	appendSection := func(source, title string, works []catalog.WorkSummary) {
		var items []TitleSearchResult
		for _, work := range works {
			if work.ID == seed.ID || work.ReadingStatus == "finished" || (!work.Readable && !work.Listenable) {
				continue
			}
			items = append(items, TitleSearchResult{
				WorkID:       work.ID,
				LibraryID:    work.LibraryID,
				Title:        work.Title,
				Author:       work.Author,
				CoverURL:     work.CoverURL,
				Readable:     work.Readable,
				Listenable:   work.Listenable,
				Synchronized: work.Synchronized,
			})
			if len(items) == 6 {
				break
			}
		}
		if len(items) > 0 {
			sections = append(sections, TrendingSection{Source: source, Title: title, Items: items})
		}
	}
	if seed.Series != "" && seed.SeriesOrder != nil {
		detail, err := store.WorkDetail(ctx, actor, seed.ID)
		if err != nil {
			return nil, err
		}
		next := detail.NextInSeries
		if next != nil && next.SeriesOrder != nil && *next.SeriesOrder > *seed.SeriesOrder {
			works, _, err := store.BrowseWorks(ctx, actor, catalog.BrowseOptions{WorkIDs: []string{next.ID}, Limit: 1})
			if err != nil {
				return nil, err
			}
			appendSection("local_series", "Next in "+seed.Series, works)
		}
	}
	if seed.Author != "" {
		works, _, err := store.BrowseWorks(ctx, actor, catalog.BrowseOptions{LibraryID: libraryID, Query: seed.Author, Sort: "relevance", Limit: 30})
		if err != nil {
			return nil, err
		}
		matches := works[:0]
		for _, work := range works {
			if catalog.MetadataKey(work.Author) == catalog.MetadataKey(seed.Author) {
				matches = append(matches, work)
			}
		}
		appendSection("local_author", "More by "+seed.Author, matches)
	}
	representations, err := store.Representations(ctx, actor, seed.ID, 20, 0)
	if err != nil {
		return nil, err
	}
	for _, representation := range representations {
		if len(representation.Narrators) == 0 {
			continue
		}
		narrator := representation.Narrators[0]
		works, _, err := store.BrowseWorks(ctx, actor, catalog.BrowseOptions{LibraryID: libraryID, Narrator: narrator, Availability: "listenable", Limit: 7})
		if err != nil {
			return nil, err
		}
		appendSection("local_narrator", "More narrated by "+narrator, works)
		break
	}
	return sections, nil
}
