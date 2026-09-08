package acquisition

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

type Settings struct {
	SABnzbdURL          string
	SABnzbdCategory     string
	SABnzbdDownloadRoot string
	HasSABnzbdAPIKey    bool
	IndexerKind         string
	IndexerURL          string
	QBitURL             string
	QBitUsername        string
	QBitCategory        string
	QBitDownloadRoot    string
	HasIndexerAPIKey    bool
	HasQBitPassword     bool
	HasNYTAPIKey        bool
}

type SettingsUpdate struct {
	PreserveSABnzbd     bool
	SABnzbdURL          string
	SABnzbdCategory     string
	SABnzbdDownloadRoot string
	SABnzbdAPIKey       string
	IndexerKind         string
	IndexerURL          string
	IndexerAPIKey       string
	NYTAPIKey           string
	QBitURL             string
	QBitUsername        string
	QBitPassword        string
	QBitCategory        string
	QBitDownloadRoot    string
}

type ConnectionStatus struct {
	QBitTorrentConfigured bool
	SABnzbdConfigured     bool
	SABnzbdOK             bool
	SABnzbdError          string
	SABnzbdFileVisibility string
	SABnzbdFileError      string
	Search                SearchReport
	FileVisibility        string
	FileError             string
	ProwlarrOK            bool
	QBitTorrentOK         bool
	IndexerCount          int
	ProwlarrError         string
	QBitTorrentError      string
}

func (s *Store) Settings(ctx context.Context, actor auth.User) (Settings, error) {
	if !actor.Admin {
		return Settings{}, ErrForbidden
	}

	options, err := s.options(ctx)
	if err != nil {
		return Settings{}, err
	}

	return Settings{
		SABnzbdURL:          options.SABnzbdURL,
		SABnzbdCategory:     options.SABnzbdCategory,
		SABnzbdDownloadRoot: options.SABnzbdDownloadRoot,
		HasSABnzbdAPIKey:    options.SABnzbdAPIKey != "",
		IndexerKind:         options.IndexerKind,
		IndexerURL:          options.IndexerURL,
		QBitURL:             options.QBitURL,
		QBitUsername:        options.QBitUsername,
		QBitCategory:        options.Category,
		QBitDownloadRoot:    options.DownloadRoot,
		HasIndexerAPIKey:    options.IndexerAPIKey != "",
		HasQBitPassword:     options.QBitPassword != "",
		HasNYTAPIKey:        options.NYTAPIKey != "",
	}, nil
}

func (s *Store) UpdateSettings(ctx context.Context, actor auth.User, update SettingsUpdate) (Settings, error) {
	if !actor.Admin {
		return Settings{}, ErrForbidden
	}

	s.clientMu.Lock()
	defer s.clientMu.Unlock()

	current, err := s.options(ctx)
	if err != nil {
		return Settings{}, err
	}

	options := Options{
		SABnzbdURL:          strings.TrimSpace(update.SABnzbdURL),
		SABnzbdAPIKey:       strings.TrimSpace(update.SABnzbdAPIKey),
		SABnzbdCategory:     strings.TrimSpace(update.SABnzbdCategory),
		SABnzbdDownloadRoot: strings.TrimSpace(update.SABnzbdDownloadRoot),
		IndexerKind:         strings.TrimSpace(update.IndexerKind),
		IndexerURL:          strings.TrimSpace(update.IndexerURL),
		IndexerAPIKey:       strings.TrimSpace(update.IndexerAPIKey),
		NYTAPIKey:           strings.TrimSpace(update.NYTAPIKey),
		QBitURL:             strings.TrimSpace(update.QBitURL),
		QBitUsername:        strings.TrimSpace(update.QBitUsername),
		QBitPassword:        update.QBitPassword,
		Category:            strings.TrimSpace(update.QBitCategory),
		DownloadRoot:        strings.TrimSpace(update.QBitDownloadRoot),
	}
	if update.PreserveSABnzbd {
		options.SABnzbdURL = current.SABnzbdURL
		options.SABnzbdAPIKey = current.SABnzbdAPIKey
		options.SABnzbdCategory = current.SABnzbdCategory
		options.SABnzbdDownloadRoot = current.SABnzbdDownloadRoot
	}

	if options.IndexerKind == "" {
		options.IndexerKind = "prowlarr"
	}

	if options.IndexerKind != "prowlarr" && options.IndexerKind != "torznab" && options.IndexerKind != "newznab" {
		return Settings{}, ErrInvalid
	}

	if options.IndexerAPIKey == "" && (current.IndexerURL == "" || options.IndexerURL == current.IndexerURL) {
		options.IndexerAPIKey = current.IndexerAPIKey
	}

	if options.SABnzbdAPIKey == "" && strings.TrimRight(options.SABnzbdURL, "/") == strings.TrimRight(current.SABnzbdURL, "/") {
		options.SABnzbdAPIKey = current.SABnzbdAPIKey
	}

	if options.SABnzbdAPIKey == "" && options.SABnzbdURL != "" {
		err := s.db.QueryRowContext(ctx, `
            SELECT password FROM acquisition_download_clients
            WHERE kind='sabnzbd' AND url=? LIMIT 1
        `, strings.TrimRight(options.SABnzbdURL, "/")).Scan(&options.SABnzbdAPIKey)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return Settings{}, err
		}
	}

	if options.NYTAPIKey == "" {
		options.NYTAPIKey = current.NYTAPIKey
	}

	if options.QBitPassword == "" {
		if current.QBitURL == "" || strings.TrimRight(options.QBitURL, "/") == strings.TrimRight(current.QBitURL, "/") {
			options.QBitPassword = current.QBitPassword
		} else {
			// Re-selecting a saved endpoint may reuse its own credentials,
			// never the password belonging to the endpoint being replaced.
			err := s.db.QueryRowContext(ctx, `
				SELECT password FROM acquisition_download_clients
				WHERE kind='qbittorrent' AND url=? AND username=? LIMIT 1
			`, strings.TrimRight(options.QBitURL, "/"), options.QBitUsername).Scan(&options.QBitPassword)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return Settings{}, err
			}
		}
	}

	if options.Category == "" {
		options.Category = "aldus"
	}

	if _, err := New(options); err != nil {
		return Settings{}, ErrInvalid
	}

	if current.QBitURL != "" {
		if err := s.preserveDownloadClients(ctx, current, ""); err != nil {
			return Settings{}, err
		}
	}

	if current.SABnzbdURL != "" {
		previous := current
		previous.downloadKind = "sabnzbd"
		if err := s.preserveDownloadClients(ctx, previous, ""); err != nil {
			return Settings{}, err
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Settings{}, err
	}

	defer tx.Rollback()

	if options.QBitURL != "" {
		if _, err := saveDownloadClient(ctx, tx, options); err != nil {
			return Settings{}, err
		}
	}

	if options.SABnzbdURL != "" {
		saved := options
		saved.downloadKind = "sabnzbd"
		if _, err := saveDownloadClient(ctx, tx, saved); err != nil {
			return Settings{}, err
		}
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO acquisition_settings (
			id,
			indexer_url,
			indexer_api_key,
			nyt_api_key,
			qbittorrent_url,
			qbittorrent_username,
			qbittorrent_password,
			qbittorrent_category,
			indexer_kind,
			qbittorrent_download_root,
			updated_at
		)
		VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET
			indexer_url = excluded.indexer_url,
			indexer_api_key = excluded.indexer_api_key,
			nyt_api_key = excluded.nyt_api_key,
			qbittorrent_url = excluded.qbittorrent_url,
			qbittorrent_username = excluded.qbittorrent_username,
			qbittorrent_password = excluded.qbittorrent_password,
			qbittorrent_category = excluded.qbittorrent_category,
			indexer_kind = excluded.indexer_kind,
			qbittorrent_download_root = excluded.qbittorrent_download_root,
			updated_at = excluded.updated_at`,
		options.IndexerURL,
		options.IndexerAPIKey,
		options.NYTAPIKey,
		options.QBitURL,
		options.QBitUsername,
		options.QBitPassword,
		options.Category,
		options.IndexerKind,
		options.DownloadRoot,
		time.Now().UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return Settings{}, fmt.Errorf("save acquisition settings: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
        UPDATE acquisition_settings
        SET sabnzbd_url=?, sabnzbd_api_key=?, sabnzbd_category=?, sabnzbd_download_root=?
        WHERE id=1
    `, options.SABnzbdURL, options.SABnzbdAPIKey, options.SABnzbdCategory, options.SABnzbdDownloadRoot); err != nil {
		return Settings{}, err
	}

	if err := tx.Commit(); err != nil {
		return Settings{}, err
	}

	return s.Settings(ctx, actor)
}

func (s *Store) options(ctx context.Context) (Options, error) {
	options := s.client.options
	err := s.db.QueryRowContext(ctx, `
		SELECT
			indexer_url,
			indexer_api_key,
			nyt_api_key,
			qbittorrent_url,
			qbittorrent_username,
			qbittorrent_password,
			qbittorrent_category,
			indexer_kind,
			qbittorrent_download_root,
 sabnzbd_url, sabnzbd_api_key, sabnzbd_category, sabnzbd_download_root
		FROM acquisition_settings
		WHERE id = 1`,
	).Scan(
		&options.IndexerURL,
		&options.IndexerAPIKey,
		&options.NYTAPIKey,
		&options.QBitURL,
		&options.QBitUsername,
		&options.QBitPassword,
		&options.Category,
		&options.IndexerKind,
		&options.DownloadRoot,
		&options.SABnzbdURL, &options.SABnzbdAPIKey, &options.SABnzbdCategory, &options.SABnzbdDownloadRoot,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return options, nil
	}

	if err != nil {
		return Options{}, fmt.Errorf("load acquisition settings: %w", err)
	}

	return options, nil
}

func (s *Store) configuredClient(ctx context.Context) (*Client, error) {
	options, err := s.options(ctx)
	if err != nil {
		return nil, err
	}

	return New(options)
}

func (s *Store) TestConnections(ctx context.Context, actor auth.User) (ConnectionStatus, error) {
	if !actor.Admin {
		return ConnectionStatus{}, ErrForbidden
	}

	client, err := s.configuredClient(ctx)
	if err != nil {
		return ConnectionStatus{}, err
	}

	status := ConnectionStatus{FileVisibility: "not_tested", QBitTorrentConfigured: client.options.QBitURL != ""}
	status.Search, err = client.SearchReport(ctx, "aldus connection test")
	client.checkIndexerCapabilities(ctx, &status.Search)
	status.ProwlarrOK = status.Search.Reachable
	status.IndexerCount = len(status.Search.Indexers)
	if err != nil && !status.ProwlarrOK {
		status.ProwlarrError = "Cannot reach the search provider. Check its URL and API key."
	}

	downloads, err := client.Downloads(ctx)
	status.QBitTorrentOK = err == nil
	if err != nil {
		status.QBitTorrentError = "Cannot reach qBittorrent. Check its URL and credentials."
	} else if s.downloadIngress != "" && client.options.DownloadRoot != "" {
		var completed []Download
		for _, download := range downloads {
			if download.ReadyForImport() {
				completed = append(completed, download)
			}
		}

		if len(completed) > 0 {
			status.FileVisibility = "ok"
			if err := s.validateDownloadIngress(completed, client.options.DownloadRoot); err != nil {
				status.FileVisibility = "failed"
				status.FileError = "A completed download is not visible to Aldus. Check the shared download mount and download root."
			}
		}
	}

	status.SABnzbdConfigured = client.options.SABnzbdURL != ""
	status.SABnzbdFileVisibility = "not_tested"
	if status.SABnzbdConfigured {
		jobs, err := (sabnzbdBackend{client}).Downloads(ctx)
		if err == nil {
			err = (sabnzbdBackend{client}).validateCategory(ctx)
		}

		status.SABnzbdOK = err == nil
		if err != nil {
			status.SABnzbdError = "Check the SABnzbd URL, full API key, and configured category."
		}

		if err == nil && s.downloadIngress != "" && client.options.SABnzbdDownloadRoot != "" {
			for _, job := range jobs {
				if !job.ReadyForImport() {
					continue
				}

				status.SABnzbdFileVisibility = "ok"
				if err := s.validateDownloadIngress([]Download{job}, client.options.SABnzbdDownloadRoot); err != nil {
					status.SABnzbdFileVisibility = "failed"
					status.SABnzbdFileError = "A completed SABnzbd download is not visible to Aldus. Check the shared mount and completed download root."
					break
				}
			}
		}
	}

	return status, nil
}

func (s *Store) validateDownloadIngress(downloads []Download, remoteRoot string) error {
	info, err := os.Stat(s.downloadIngress)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("Aldus download ingress %q is unavailable; mount qBittorrent's completed-download folder there", s.downloadIngress)
	}

	directory, err := os.Open(s.downloadIngress)
	if err != nil {
		return fmt.Errorf("Aldus cannot read download ingress %q: %w", s.downloadIngress, err)
	}

	_ = directory.Close()
	if remoteRoot == "" {
		return nil
	}

	for _, download := range downloads {
		if download.ContentPath == "" {
			continue
		}

		relative, err := relativeDownloadPath(download.ContentPath, remoteRoot)
		if err != nil {
			return err
		}

		mapped := filepath.Join(s.downloadIngress, filepath.FromSlash(relative))
		if _, err := os.Stat(mapped); err != nil {
			return fmt.Errorf(
				"qBittorrent sees %q but Aldus cannot see it at %q; ALDUS_DOWNLOAD_PATH must mount the same host folder: %w",
				download.ContentPath,
				mapped,
				err,
			)
		}
	}

	return nil
}
