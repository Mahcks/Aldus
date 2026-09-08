package acquisition

import (
	"bytes"
	"context"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
)

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

type SubmissionReceipt struct {
	Hash      string
	Ownership string
}

func (c *Client) submitTracked(ctx context.Context, downloadURL, tag string) (SubmissionReceipt, error) {
	if c.options.QBitURL == "" {
		return SubmissionReceipt{Ownership: "unknown"}, ErrUnavailable
	}

	if !validDownloadURL(downloadURL) {
		return SubmissionReceipt{Ownership: "unknown"}, errors.New("invalid download URL")
	}

	if tag != "" && !validTag(tag) {
		return SubmissionReceipt{Ownership: "unknown"}, errors.New("invalid download tag")
	}

	infoHash := magnetInfoHash(downloadURL)
	cookies, err := c.login(ctx)
	if err != nil {
		return SubmissionReceipt{Ownership: "unknown"}, err
	}

	if err := c.ensureCategory(ctx, cookies); err != nil {
		return SubmissionReceipt{Ownership: "unknown"}, err
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if c.shouldFetchTorrent(downloadURL) {
		torrent, err := c.fetchTorrent(ctx, downloadURL)
		var redirect magnetRedirectError
		if errors.As(err, &redirect) {
			infoHash = magnetInfoHash(redirect.URL)
			err = writer.WriteField("urls", redirect.URL)
		}

		if err != nil {
			return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, err
		}

		if redirect.URL == "" {
			part, err := writer.CreateFormFile("torrents", "download.torrent")
			if err != nil {
				return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("build qBittorrent request: %w", err)
			}

			if _, err := part.Write(torrent); err != nil {
				return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("build qBittorrent request: %w", err)
			}
		}
	} else if err := writer.WriteField("urls", downloadURL); err != nil {
		return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("build qBittorrent request: %w", err)
	}

	if c.options.Category != "" {
		if err := writer.WriteField("category", c.options.Category); err != nil {
			return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("build qBittorrent request: %w", err)
		}
	}

	if tag != "" {
		if err := writer.WriteField("tags", tag); err != nil {
			return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("build qBittorrent request: %w", err)
		}
	}

	if err := writer.Close(); err != nil {
		return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("build qBittorrent request: %w", err)
	}

	// Snapshot before submitting. A failed lookup cannot establish ownership.
	before, beforeErr := c.Downloads(ctx)
	for _, download := range before {
		if infoHash != "" && strings.EqualFold(download.Hash, infoHash) {
			return SubmissionReceipt{Hash: download.Hash, Ownership: "adopted"}, nil
		}
	}

	req, err := c.qbitRequest(ctx, http.MethodPost, "/api/v2/torrents/add", &body)
	if err != nil {
		return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("build qBittorrent request: %w", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}

	response, err := c.http.Do(req)
	if err != nil {
		return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("%w: send download to qBittorrent: %v", ErrSubmissionUnknown, err)
	}

	defer response.Body.Close()

	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, (4<<10)+1))
	if readErr != nil {
		return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("%w: read qBittorrent response: %v", ErrSubmissionUnknown, readErr)
	}

	if len(responseBody) > 4<<10 {
		return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("%w: qBittorrent response is too large", ErrSubmissionUnknown)
	}

	responseText := strings.TrimSpace(string(responseBody))
	if response.StatusCode == http.StatusConflict {
		// A conflict can mean the torrent already exists. Reuse only a verified
		// match in the configured category, never a title or an arbitrary torrent.
		downloads, err := c.Downloads(ctx)
		if err != nil {
			return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("%w: verify conflicting qBittorrent submission: %v", ErrSubmissionUnknown, err)
		}

		for _, download := range downloads {
			if download.Hash != "" && ((infoHash != "" && strings.EqualFold(download.Hash, infoHash)) || (tag != "" && download.HasTag(tag))) {
				return SubmissionReceipt{Hash: download.Hash, Ownership: "adopted"}, nil
			}
		}
	}

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("send download to qBittorrent: status %d: %q", response.StatusCode, responseText)
	}

	if err := acceptedAddResponse(responseText); err != nil {
		if errors.Is(err, errSubmissionPending) && infoHash != "" {
			return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, nil
		}

		if errors.Is(err, errSubmissionRejected) {
			return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("send download to qBittorrent: status %d: %w", response.StatusCode, err)
		}

		return SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}, fmt.Errorf("%w: qBittorrent returned status %d: %v", ErrSubmissionUnknown, response.StatusCode, err)
	}

	receipt := SubmissionReceipt{Hash: infoHash, Ownership: "unknown"}
	// Duplicate submissions do not apply the new request tag. Require a
	// previously absent hash and that exact tag after an acknowledged add.
	if beforeErr == nil && tag != "" {
		downloads, err := c.Downloads(ctx)
		if err == nil {
			var matches []Download
			for _, download := range downloads {
				if download.Hash != "" && download.HasTag(tag) && (infoHash == "" || strings.EqualFold(download.Hash, infoHash)) {
					matches = append(matches, download)
				}
			}

			if len(matches) == 1 {
				candidate := matches[0]
				existed := false
				for _, download := range before {
					if strings.EqualFold(download.Hash, candidate.Hash) || download.HasTag(tag) {
						existed = true
					}
				}

				if !existed {
					receipt.Hash = candidate.Hash
					receipt.Ownership = "created"
				}
			}
		}
	}

	return receipt, nil
}

type magnetRedirectError struct{ URL string }

func (e magnetRedirectError) Error() string {
	return "indexer redirected to magnet"
}

func (c *Client) shouldFetchTorrent(raw string) bool {
	download, err := url.Parse(raw)
	indexer, indexerErr := url.Parse(c.options.IndexerURL)
	return err == nil && indexerErr == nil && sameOrigin(indexer, download) && (download.Scheme == "http" || download.Scheme == "https")
}

func (c *Client) fetchTorrent(ctx context.Context, raw string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, errors.New("build torrent download request: invalid request")
	}

	req.Header.Set("X-Api-Key", c.options.IndexerAPIKey)
	response, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("download torrent from indexer: %w", ctx.Err())
		}

		// Preserve the supported magnet handoff without retaining net/http's
		// URL-bearing error wrapper, which may contain tracker credentials.
		var redirect magnetRedirectError
		if errors.As(err, &redirect) {
			return nil, redirect
		}

		return nil, errors.New("download torrent from indexer: request failed")
	}

	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download torrent from indexer: status %d", response.StatusCode)
	}

	const maxTorrentSize = 16 << 20
	body, err := io.ReadAll(io.LimitReader(response.Body, maxTorrentSize+1))
	if err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("download torrent from indexer: %w", ctx.Err())
		}

		return nil, errors.New("download torrent from indexer: could not read response")
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
		Seeds       int     `json:"num_seeds"`
		Peers       int     `json:"num_leechs"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&raw); err != nil {
		return nil, fmt.Errorf("parse qBittorrent downloads: %w", err)
	}

	downloads := make([]Download, len(raw))
	for i, item := range raw {
		downloads[i] = Download{
			Hash: item.Hash, Name: item.Name, State: item.State, ContentPath: item.ContentPath, Tags: item.Tags,
			Progress: item.Progress, Size: item.Size,
			Seeds: item.Seeds, Peers: item.Peers,
		}
	}

	return downloads, nil
}

func (c *Client) CancelTracked(ctx context.Context, hash, tag string) error {
	if (tag != "" && !validTag(tag)) || (tag == "" && hash == "") {
		return errors.New("invalid download tag")
	}

	downloads, err := c.Downloads(ctx)
	if err != nil {
		return err
	}

	var hashes []string
	for _, download := range downloads {
		if download.Hash != "" && hash != "" && strings.EqualFold(download.Hash, hash) {
			hashes = []string{download.Hash}
			break
		}
	}

	if len(hashes) == 0 && hash == "" {
		for _, download := range downloads {
			if download.HasTag(tag) && download.Hash != "" {
				hashes = append(hashes, download.Hash)
			}
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

func magnetInfoHash(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "magnet" {
		return ""
	}

	for _, exactTopic := range u.Query()["xt"] {
		value := strings.TrimPrefix(strings.ToLower(exactTopic), "urn:btih:")
		if value == strings.ToLower(exactTopic) {
			continue
		}

		if len(value) == 40 {
			if _, err := hex.DecodeString(value); err == nil {
				return value
			}
		}

		if len(value) == 32 {
			decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(value))
			if err == nil && len(decoded) == 20 {
				return hex.EncodeToString(decoded)
			}
		}
	}

	return ""
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
