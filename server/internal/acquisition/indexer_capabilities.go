package acquisition

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Capability checks are explicit connection diagnostics, not extra requests for
// every book search. A failed capability check never hides successful results.
func (c *Client) checkIndexerCapabilities(ctx context.Context, report *SearchReport) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var workers sync.WaitGroup
	semaphore := make(chan struct{}, 4)
	for i := range report.Indexers {
		select {
		case semaphore <- struct{}{}:
		case <-ctx.Done():
			workers.Wait()
			for j := i; j < len(report.Indexers); j++ {
				report.Indexers[j].Capabilities = "Category support could not be checked. Retry the connection test."
			}
			return
		}

		workers.Add(1)
		go func(index int) {
			defer workers.Done()

			defer func() { <-semaphore }()

			endpoint := c.options.IndexerURL
			if c.options.IndexerKind == "prowlarr" {
				endpoint = fmt.Sprintf("%s/%d/api", strings.TrimRight(endpoint, "/"), report.Indexers[index].ID)
			}

			report.Indexers[index].Capabilities = c.categorySupport(ctx, endpoint)
		}(i)
	}

	workers.Wait()
}

type indexerCategory struct {
	ID       int               `xml:"id,attr"`
	Children []indexerCategory `xml:"subcat"`
}

func (c *Client) categorySupport(ctx context.Context, endpoint string) string {
	const unavailable = "Category support could not be checked. Search results are shown separately."
	u, err := url.Parse(endpoint)
	if err != nil {
		return unavailable
	}

	query := u.Query()
	query.Set("t", "caps")
	query.Set("apikey", c.options.IndexerAPIKey)
	u.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return unavailable
	}

	response, err := c.http.Do(req)
	if err != nil {
		return unavailable
	}

	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return unavailable
	}

	var capabilities struct {
		XMLName    xml.Name          `xml:"caps"`
		Categories []indexerCategory `xml:"categories>category"`
		Search     struct {
			Available string `xml:"available,attr"`
		} `xml:"searching>search"`
	}
	if err := xml.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&capabilities); err != nil {
		return unavailable
	}

	if capabilities.Search.Available == "no" {
		return "This indexer does not advertise general search support. Check its configuration."
	}

	if len(capabilities.Categories) == 0 {
		return "This indexer does not advertise categories; book category support is unknown."
	}

	ebooks, audio := bookCategories(capabilities.Categories)
	switch {
	case ebooks && audio:
		return "Book and audiobook categories are supported."
	case ebooks:
		return "Book categories are supported; no audiobook category is advertised."
	case audio:
		return "Audiobook categories are supported; no book category is advertised."
	default:
		return "No standard book or audiobook categories are advertised. Check this indexer in Prowlarr or Torznab."
	}
}

func bookCategories(categories []indexerCategory) (bool, bool) {
	var ebooks, audio bool
	for _, category := range categories {
		ebooks = ebooks || category.ID >= 7000 && category.ID < 8000
		audio = audio || category.ID == 3030
		childBooks, childAudio := bookCategories(category.Children)
		ebooks = ebooks || childBooks
		audio = audio || childAudio
	}

	return ebooks, audio
}
