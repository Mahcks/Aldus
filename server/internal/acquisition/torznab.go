package acquisition

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
)

func (c *Client) searchFeed(ctx context.Context, rawURL, query, source string) ([]Result, error) {
	results, _, err := c.searchFeedReport(ctx, rawURL, query, source)
	return results, err
}

func (c *Client) searchFeedReport(ctx context.Context, rawURL, query, source string) ([]Result, int, error) {
	protocol := "torrent"
	if c.options.IndexerKind == "newznab" {
		protocol = "usenet"
	}

	return c.searchProtocolFeed(ctx, rawURL, query, source, protocol)
}

func (c *Client) searchProtocolFeed(ctx context.Context, rawURL, query, source, protocol string) ([]Result, int, error) {
	u, _ := url.Parse(rawURL)
	values := u.Query()
	values.Set("t", "search")
	values.Set("q", query)
	values.Set("cat", "3030,7000")
	values.Set("apikey", c.options.IndexerAPIKey)
	u.RawQuery = values.Encode()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	response, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, 0, fmt.Errorf("search indexer: %w", ctx.Err())
		}

		return nil, 0, errors.New("search indexer: request failed")
	}

	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("search indexer: status %d", response.StatusCode)
	}

	var feed struct {
		XMLName          xml.Name
		ErrorCode        string `xml:"code,attr"`
		ErrorDescription string `xml:"description,attr"`
		Items            []struct {
			Title     string `xml:"title"`
			GUID      string `xml:"guid"`
			Link      string `xml:"link"`
			PubDate   string `xml:"pubDate"`
			Enclosure struct {
				URL    string `xml:"url,attr"`
				Length string `xml:"length,attr"`
				Type   string `xml:"type,attr"`
			} `xml:"enclosure"`
			Attributes []feedAttribute `xml:"attr"`
		} `xml:"channel>item"`
	}
	if err := xml.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&feed); err != nil {
		return nil, 0, fmt.Errorf("parse indexer response: %w", err)
	}

	if feed.XMLName.Local == "error" {
		return nil, 0, errors.New("search indexer: provider rejected the query")
	}

	excluded := 0
	results := make([]Result, 0, len(feed.Items))
	for _, item := range feed.Items {
		metadata := feedMetadata(item.GUID, item.Enclosure.Type, item.Attributes)
		if protocol == "usenet" {
			metadata.Protocol = "usenet"
		}

		if (metadata.Protocol == "usenet" && c.options.SABnzbdURL == "") || (metadata.Protocol != "torrent" && metadata.Protocol != "usenet") || (!supportedReleaseTitle(item.Title) && metadata.Format == "") {
			excluded++
			continue
		}

		download := item.Enclosure.URL
		if download == "" {
			download = item.Link
		}

		resolved, err := resolveDownloadURL(u, download)
		if err != nil {
			continue
		}

		var size int64
		_, _ = fmt.Sscan(item.Enclosure.Length, &size)
		for _, attribute := range item.Attributes {
			if attribute.Name == "size" && size == 0 {
				_, _ = fmt.Sscan(attribute.Value, &size)
			}
		}

		if size < 0 {
			size = 0
		}

		published, _ := parseTime(item.PubDate)
		if source == "" {
			source = u.Hostname()
		}

		results = append(results, Result{
			Metadata:    metadata,
			Title:       strings.TrimSpace(item.Title),
			DownloadURL: resolved,
			Source:      source,
			Size:        size,
			Published:   published,
		})
	}

	return results, excluded, nil
}

func supportedReleaseTitle(title string) bool {
	formats := map[string]bool{
		"epub":      true,
		"audiobook": true,
		"mp3":       true,
		"m4a":       true,
		"m4b":       true,
		"aac":       true,
		"flac":      true,
		"ogg":       true,
		"opus":      true,
		"wav":       true,
	}
	words := strings.FieldsFunc(strings.ToLower(title), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	for _, word := range words {
		if formats[word] {
			return true
		}
	}

	return false
}

func resolveDownloadURL(base *url.URL, raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}

	u = base.ResolveReference(u)
	if !validDownloadURL(u.String()) {
		return "", errors.New("invalid download URL")
	}

	return u.String(), nil
}

func parseTime(raw string) (time.Time, error) {
	for _, layout := range []string{time.RFC1123Z, time.RFC1123} {
		if parsed, err := time.Parse(layout, strings.TrimSpace(raw)); err == nil {
			return parsed, nil
		}
	}

	return time.Time{}, errors.New("invalid publication time")
}
