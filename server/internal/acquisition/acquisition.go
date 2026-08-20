package acquisition

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
)

var (
	ErrUnavailable       = errors.New("acquisition is not configured")
	ErrSubmissionUnknown = errors.New("qBittorrent submission outcome is unknown")
)

type Options struct {
	IndexerKind, IndexerURL, IndexerAPIKey                      string
	QBitURL, QBitUsername, QBitPassword, Category, DownloadRoot string
}

type Client struct {
	options Options
	http    *http.Client
}

type Result struct {
	Title, DownloadURL, Source string
	Size                       int64
	Published                  time.Time
}

type Indexer struct {
	ID             int
	Name, Protocol string
	Enabled        bool
}

type Download struct {
	Hash, Name, State, ContentPath, Tags string
	Progress                             float64
	Size                                 int64
}

func (d Download) HasTag(tag string) bool {
	for value := range strings.SplitSeq(d.Tags, ",") {
		if strings.TrimSpace(value) == tag {
			return true
		}
	}
	return false
}

func (d Download) ReadyForImport() bool {
	if d.Progress < 1 || d.ContentPath == "" {
		return false
	}
	switch strings.ToLower(d.State) {
	case "uploading", "stalledup", "queuedup", "forcedup", "pausedup", "stoppedup":
		return true
	default:
		return false
	}
}

func New(options Options) (*Client, error) {
	if options.IndexerKind != "" && options.IndexerKind != "prowlarr" && options.IndexerKind != "torznab" {
		return nil, fmt.Errorf("invalid indexer kind %q", options.IndexerKind)
	}
	for _, raw := range []string{options.IndexerURL, options.QBitURL} {
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return nil, fmt.Errorf("invalid acquisition URL %q", raw)
		}
	}
	return &Client{options: options, http: &http.Client{
		Timeout: 20 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > 0 && !sameOrigin(via[0].URL, req.URL) {
				return errors.New("cross-origin redirect refused")
			}
			return nil
		},
	}}, nil
}

func (c *Client) Search(ctx context.Context, query string) ([]Result, error) {
	query = strings.TrimSpace(query)
	if c.options.IndexerURL == "" || query == "" {
		return nil, ErrUnavailable
	}
	if c.options.IndexerKind == "prowlarr" {
		return c.searchProwlarr(ctx, query)
	}
	return c.searchFeed(ctx, c.options.IndexerURL, query, "")
}

func (c *Client) Indexers(ctx context.Context) ([]Indexer, error) {
	if c.options.IndexerKind != "prowlarr" || c.options.IndexerURL == "" {
		return nil, ErrUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(c.options.IndexerURL, "/")+"/api/v1/indexer", nil)
	if err != nil {
		return nil, fmt.Errorf("build Prowlarr request: %w", err)
	}
	req.Header.Set("X-Api-Key", c.options.IndexerAPIKey)
	response, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("connect to Prowlarr: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("connect to Prowlarr: status %d", response.StatusCode)
	}
	var raw []struct {
		ID       int    `json:"id"`
		Name     string `json:"name"`
		Protocol string `json:"protocol"`
		Enable   bool   `json:"enable"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&raw); err != nil {
		return nil, fmt.Errorf("read Prowlarr indexers: %w", err)
	}
	result := make([]Indexer, 0, len(raw))
	for _, value := range raw {
		if value.ID > 0 && strings.TrimSpace(value.Name) != "" {
			result = append(result, Indexer{ID: value.ID, Name: strings.TrimSpace(value.Name), Protocol: strings.ToLower(value.Protocol), Enabled: value.Enable})
		}
	}
	return result, nil
}

func (c *Client) searchProwlarr(ctx context.Context, query string) ([]Result, error) {
	indexers, err := c.Indexers(ctx)
	if err != nil {
		return nil, err
	}
	type response struct {
		values []Result
		err    error
	}
	results := make(chan response, len(indexers))
	semaphore := make(chan struct{}, 4)
	var count int
	for _, indexer := range indexers {
		if !indexer.Enabled || indexer.Protocol != "torrent" {
			continue
		}
		count++
		go func(value Indexer) {
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			feed := fmt.Sprintf("%s/%d/api", strings.TrimRight(c.options.IndexerURL, "/"), value.ID)
			items, err := c.searchFeed(ctx, feed, query, value.Name)
			results <- response{values: items, err: err}
		}(indexer)
	}
	if count == 0 {
		return nil, errors.New("Prowlarr has no enabled torrent indexers")
	}
	var combined []Result
	var firstErr error
	for range count {
		value := <-results
		if value.err != nil && firstErr == nil {
			firstErr = value.err
		}
		combined = append(combined, value.values...)
	}
	if len(combined) == 0 && firstErr != nil {
		return nil, firstErr
	}
	return combined, nil
}

func (c *Client) searchFeed(ctx context.Context, rawURL, query, source string) ([]Result, error) {
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
		return nil, fmt.Errorf("search indexer: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("search indexer: status %d", response.StatusCode)
	}
	var feed struct {
		XMLName          xml.Name
		ErrorCode        string `xml:"code,attr"`
		ErrorDescription string `xml:"description,attr"`
		Items            []struct {
			Title     string `xml:"title"`
			Link      string `xml:"link"`
			PubDate   string `xml:"pubDate"`
			Enclosure struct {
				URL    string `xml:"url,attr"`
				Length string `xml:"length,attr"`
			} `xml:"enclosure"`
			Attributes []struct {
				Name  string `xml:"name,attr"`
				Value string `xml:"value,attr"`
			} `xml:"attr"`
		} `xml:"channel>item"`
	}
	if err := xml.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&feed); err != nil {
		return nil, fmt.Errorf("parse indexer response: %w", err)
	}
	if feed.XMLName.Local == "error" {
		return nil, fmt.Errorf("search indexer: protocol error %s: %s", feed.ErrorCode, feed.ErrorDescription)
	}
	results := make([]Result, 0, len(feed.Items))
	for _, item := range feed.Items {
		if !supportedReleaseTitle(item.Title) {
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
		results = append(results, Result{Title: strings.TrimSpace(item.Title), DownloadURL: resolved, Source: source, Size: size, Published: published})
	}
	return results, nil
}

func supportedReleaseTitle(title string) bool {
	formats := map[string]bool{"epub": true, "audiobook": true, "mp3": true, "m4a": true, "m4b": true, "aac": true, "flac": true, "ogg": true, "opus": true, "wav": true}
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

func (c *Client) Add(ctx context.Context, downloadURL string) error {
	return c.AddTracked(ctx, downloadURL, "")
}

func (c *Client) RemoveTag(ctx context.Context, hash, tag string) error {
	if hash == "" || !validTag(tag) {
		return nil
	}
	cookies, err := c.login(ctx)
	if err != nil {
		return err
	}
	form := url.Values{"hashes": {hash}, "tags": {tag}}
	req, err := c.qbitRequest(ctx, http.MethodPost, "/api/v2/torrents/removeTags", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("remove qBittorrent tag: status %d", response.StatusCode)
	}
	return nil
}

func (c *Client) AddTracked(ctx context.Context, downloadURL, tag string) error {
	if c.options.QBitURL == "" {
		return ErrUnavailable
	}
	if !validDownloadURL(downloadURL) {
		return errors.New("invalid download URL")
	}
	if tag != "" && !validTag(tag) {
		return errors.New("invalid download tag")
	}
	cookies, err := c.login(ctx)
	if err != nil {
		return err
	}
	if err := c.ensureCategory(ctx, cookies); err != nil {
		return err
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if c.shouldFetchTorrent(downloadURL) {
		torrent, err := c.fetchTorrent(ctx, downloadURL)
		if err != nil {
			return err
		}
		part, err := writer.CreateFormFile("torrents", "download.torrent")
		if err != nil {
			return fmt.Errorf("build qBittorrent request: %w", err)
		}
		if _, err := part.Write(torrent); err != nil {
			return fmt.Errorf("build qBittorrent request: %w", err)
		}
	} else if err := writer.WriteField("urls", downloadURL); err != nil {
		return fmt.Errorf("build qBittorrent request: %w", err)
	}
	if c.options.Category != "" {
		if err := writer.WriteField("category", c.options.Category); err != nil {
			return fmt.Errorf("build qBittorrent request: %w", err)
		}
	}
	if tag != "" {
		if err := writer.WriteField("tags", tag); err != nil {
			return fmt.Errorf("build qBittorrent request: %w", err)
		}
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("build qBittorrent request: %w", err)
	}
	req, err := c.qbitRequest(ctx, http.MethodPost, "/api/v2/torrents/add", &body)
	if err != nil {
		return fmt.Errorf("build qBittorrent request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: send download to qBittorrent: %v", ErrSubmissionUnknown, err)
	}
	defer response.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, (4<<10)+1))
	if readErr != nil {
		return fmt.Errorf("%w: read qBittorrent response: %v", ErrSubmissionUnknown, readErr)
	}
	if len(responseBody) > 4<<10 {
		return fmt.Errorf("%w: qBittorrent response is too large", ErrSubmissionUnknown)
	}
	responseText := strings.TrimSpace(string(responseBody))
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("send download to qBittorrent: status %d: %q", response.StatusCode, responseText)
	}
	if err := acceptedAddResponse(responseText); err != nil {
		if errors.Is(err, errSubmissionRejected) {
			return fmt.Errorf("send download to qBittorrent: status %d: %w", response.StatusCode, err)
		}
		return fmt.Errorf("%w: qBittorrent returned status %d: %v", ErrSubmissionUnknown, response.StatusCode, err)
	}
	return nil
}

func (c *Client) shouldFetchTorrent(raw string) bool {
	download, err := url.Parse(raw)
	indexer, indexerErr := url.Parse(c.options.IndexerURL)
	return err == nil && indexerErr == nil && sameOrigin(indexer, download) && (download.Scheme == "http" || download.Scheme == "https")
}

func (c *Client) fetchTorrent(ctx context.Context, raw string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, fmt.Errorf("build torrent download request: %w", err)
	}
	req.Header.Set("X-Api-Key", c.options.IndexerAPIKey)
	response, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download torrent from indexer: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download torrent from indexer: status %d", response.StatusCode)
	}
	const maxTorrentSize = 16 << 20
	body, err := io.ReadAll(io.LimitReader(response.Body, maxTorrentSize+1))
	if err != nil {
		return nil, fmt.Errorf("download torrent from indexer: %w", err)
	}
	if len(body) == 0 || len(body) > maxTorrentSize {
		return nil, errors.New("download torrent from indexer: invalid file size")
	}
	return body, nil
}

var errSubmissionRejected = errors.New("qBittorrent rejected the download")
var errSubmissionPending = errors.New("qBittorrent is still processing the download")

func acceptedAddResponse(body string) error {
	if body == "" || body == "Ok." {
		return nil
	}
	var receipt struct {
		AddedTorrentIDs []string `json:"added_torrent_ids"`
		FailureCount    *int     `json:"failure_count"`
		PendingCount    *int     `json:"pending_count"`
		SuccessCount    *int     `json:"success_count"`
	}
	if err := json.Unmarshal([]byte(body), &receipt); err != nil {
		return fmt.Errorf("unexpected response %q", body)
	}
	if receipt.FailureCount == nil || receipt.PendingCount == nil || receipt.SuccessCount == nil || *receipt.FailureCount < 0 || *receipt.PendingCount < 0 || *receipt.SuccessCount < 0 {
		return errors.New("malformed add receipt")
	}
	if *receipt.SuccessCount > 0 || len(receipt.AddedTorrentIDs) > 0 {
		return nil
	}
	if *receipt.PendingCount > 0 {
		return errSubmissionPending
	}
	if *receipt.FailureCount > 0 {
		return errSubmissionRejected
	}
	return errors.New("contradictory empty add receipt")
}

func (c *Client) ensureCategory(ctx context.Context, cookies []*http.Cookie) error {
	if c.options.Category == "" {
		return nil
	}
	req, _ := c.qbitRequest(ctx, http.MethodGet, "/api/v2/torrents/categories", nil)
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("list qBittorrent categories: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("list qBittorrent categories: status %d", response.StatusCode)
	}
	var categories map[string]json.RawMessage
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&categories); err != nil {
		return fmt.Errorf("read qBittorrent categories: %w", err)
	}
	if _, exists := categories[c.options.Category]; exists {
		return nil
	}
	values := url.Values{"category": {c.options.Category}}
	req, _ = c.qbitRequest(ctx, http.MethodPost, "/api/v2/torrents/createCategory", strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	response, err = c.http.Do(req)
	if err != nil {
		return fmt.Errorf("create qBittorrent category: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("create qBittorrent category: status %d", response.StatusCode)
	}
	return nil
}

func (c *Client) Downloads(ctx context.Context) ([]Download, error) {
	if c.options.QBitURL == "" {
		return nil, ErrUnavailable
	}
	cookies, err := c.login(ctx)
	if err != nil {
		return nil, err
	}
	values := url.Values{}
	if c.options.Category != "" {
		values.Set("category", c.options.Category)
	}
	req, err := c.qbitRequest(ctx, http.MethodGet, "/api/v2/torrents/info?"+values.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("build qBittorrent request: %w", err)
	}
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("list qBittorrent downloads: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("list qBittorrent downloads: status %d", response.StatusCode)
	}
	var raw []struct {
		Hash        string  `json:"hash"`
		Name        string  `json:"name"`
		State       string  `json:"state"`
		ContentPath string  `json:"content_path"`
		Tags        string  `json:"tags"`
		Progress    float64 `json:"progress"`
		Size        int64   `json:"size"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&raw); err != nil {
		return nil, fmt.Errorf("parse qBittorrent downloads: %w", err)
	}
	downloads := make([]Download, len(raw))
	for i, item := range raw {
		downloads[i] = Download{
			Hash: item.Hash, Name: item.Name, State: item.State, ContentPath: item.ContentPath, Tags: item.Tags,
			Progress: item.Progress, Size: item.Size,
		}
	}
	return downloads, nil
}

func (c *Client) CancelTagged(ctx context.Context, tag string) error {
	if !validTag(tag) {
		return errors.New("invalid download tag")
	}
	downloads, err := c.Downloads(ctx)
	if err != nil {
		return err
	}
	var hashes []string
	for _, download := range downloads {
		if download.HasTag(tag) && download.Hash != "" {
			hashes = append(hashes, download.Hash)
		}
	}
	if len(hashes) == 0 {
		return nil
	}
	cookies, err := c.login(ctx)
	if err != nil {
		return err
	}
	values := url.Values{"hashes": {strings.Join(hashes, "|")}, "deleteFiles": {"true"}}
	req, err := c.qbitRequest(ctx, http.MethodPost, "/api/v2/torrents/delete", strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("cancel qBittorrent download: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("cancel qBittorrent download: status %d", response.StatusCode)
	}
	return nil
}

func (c *Client) login(ctx context.Context) ([]*http.Cookie, error) {
	form := url.Values{"username": {c.options.QBitUsername}, "password": {c.options.QBitPassword}}
	req, err := c.qbitRequest(ctx, http.MethodPost, "/api/v2/auth/login", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("build qBittorrent request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("log in to qBittorrent: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<10))
	if err != nil {
		return nil, fmt.Errorf("read qBittorrent login: %w", err)
	}
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusNoContent {
		return nil, fmt.Errorf("log in to qBittorrent: status %d", response.StatusCode)
	}
	if response.StatusCode == http.StatusOK && strings.TrimSpace(string(body)) != "Ok." {
		return nil, fmt.Errorf("log in to qBittorrent: status %d", response.StatusCode)
	}
	if cookies := response.Cookies(); len(cookies) > 0 {
		return cookies, nil
	}
	if response.StatusCode == http.StatusNoContent {
		return nil, nil
	}
	return nil, errors.New("log in to qBittorrent: missing session cookie")
}

func (c *Client) qbitEndpoint(path string) string {
	return strings.TrimRight(c.options.QBitURL, "/") + path
}

func (c *Client) qbitRequest(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.qbitEndpoint(path), body)
	if err != nil {
		return nil, err
	}
	base, _ := url.Parse(c.options.QBitURL)
	origin := base.Scheme + "://" + base.Host
	req.Header.Set("Origin", origin)
	req.Header.Set("Referer", origin+"/")
	return req, nil
}

func sameOrigin(a, b *url.URL) bool {
	return strings.EqualFold(a.Scheme, b.Scheme) && strings.EqualFold(a.Host, b.Host)
}

func validDownloadURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil {
		return false
	}
	if u.Scheme == "magnet" {
		return strings.HasPrefix(strings.ToLower(u.Query().Get("xt")), "urn:btih:")
	}
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func validTag(tag string) bool {
	if len(tag) > 100 {
		return false
	}
	for _, r := range tag {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '-' && r != '_' {
			return false
		}
	}
	return tag != ""
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
