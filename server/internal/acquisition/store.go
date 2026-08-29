package acquisition

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/source"
)

var (
	ErrNotFound  = errors.New("acquisition request not found")
	ErrInvalid   = errors.New("invalid acquisition request")
	ErrForbidden = errors.New("administrator access required")
)

type Settings struct {
	IndexerKind      string
	IndexerURL       string
	QBitURL          string
	QBitUsername     string
	QBitCategory     string
	QBitDownloadRoot string
	HasIndexerAPIKey bool
	HasQBitPassword  bool
}

type SettingsUpdate struct {
	IndexerKind      string
	IndexerURL       string
	IndexerAPIKey    string
	QBitURL          string
	QBitUsername     string
	QBitPassword     string
	QBitCategory     string
	QBitDownloadRoot string
}

type ConnectionStatus struct {
	ProwlarrOK       bool
	QBitTorrentOK    bool
	IndexerCount     int
	ProwlarrError    string
	QBitTorrentError string
}

type Request struct {
	ID                string
	LibraryID         string
	RequestedBy       string
	SourceID          string
	Query             string
	Status            string
	PairID            string
	DownloadState     string
	DownloadError     string
	FulfillmentState  string
	ScanID            string
	ProposalID        string
	WorkID            string
	SelectedTitle     string
	SelectedSource    string
	SelectedSize      int64
	SelectedPublished time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type SearchResult struct {
	ID              string
	Title           string
	Source          string
	CanonicalTitle  string
	Author          string
	Language        string
	Format          string
	Kind            string
	Edition         string
	Narrator        string
	GroupKey        string
	Match           string
	ISBN            string
	CoverID         string
	CoverURL        string
	Description     string
	OpenLibraryID   string
	MatchConfidence string
	MatchReasons    []string
	LikelyPairIDs   []string
	Size            int64
	Published       time.Time
	Relevance       int
	Year            int
	Abridged        bool
	downloadURL     string
}

type Discovery struct {
	ID      string
	Results []SearchResult
}

type Pair struct {
	ID       string
	Requests []Request
}

type Destination struct {
	LibraryID   string
	LibraryName string
	SourceID    string
	SourceName  string
}

type Tracker struct {
	Requests    []Request
	UnreadCount int
}

type ReadyPair struct {
	ID           string
	RequestedBy  string
	EPUBMediaID  string
	EPUBSHA256   string
	AudioMediaID string
	AudioSHA256  string
}

type selectedDiscoveryResult struct {
	Download Result
	Metadata SearchResult
}

type discoverySession struct {
	LibraryID string
	SourceID  string
	Query     string
	UserID    string
	ExpiresAt time.Time
	Results   map[string]selectedDiscoveryResult
}

type Store struct {
	db              *sql.DB
	client          *Client
	handoff         func(context.Context, string, string, string, string) (string, error)
	pairHandoff     func(context.Context, ReadyPair) error
	retryScan       func(context.Context, string, string) error
	downloadIngress string
	selectMu        sync.Mutex
	metadataMu      sync.Mutex
	metadataCache   map[string]cachedMetadata
	discoveryMu     sync.Mutex
	discoveries     map[string]discoverySession
	startOnce       sync.Once
	done            chan struct{}
}

func NewStore(db *sql.DB, client *Client) *Store {
	return &Store{
		db:            db,
		client:        client,
		metadataCache: make(map[string]cachedMetadata),
		discoveries:   make(map[string]discoverySession),
		done:          make(chan struct{}),
	}
}

func (s *Store) SetHandoff(handoff func(context.Context, string, string, string, string) (string, error)) {
	s.handoff = handoff
}

func (s *Store) SetPairHandoff(handoff func(context.Context, ReadyPair) error) {
	s.pairHandoff = handoff
}

func (s *Store) SetScanRetry(retry func(context.Context, string, string) error) {
	s.retryScan = retry
}

func (s *Store) SetDownloadIngress(root string) {
	s.downloadIngress = strings.TrimSpace(root)
	if s.downloadIngress != "" {
		s.downloadIngress = filepath.Clean(s.downloadIngress)
	}
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
		IndexerKind:      options.IndexerKind,
		IndexerURL:       options.IndexerURL,
		QBitURL:          options.QBitURL,
		QBitUsername:     options.QBitUsername,
		QBitCategory:     options.Category,
		QBitDownloadRoot: options.DownloadRoot,
		HasIndexerAPIKey: options.IndexerAPIKey != "",
		HasQBitPassword:  options.QBitPassword != "",
	}, nil
}

func (s *Store) UpdateSettings(ctx context.Context, actor auth.User, update SettingsUpdate) (Settings, error) {
	if !actor.Admin {
		return Settings{}, ErrForbidden
	}
	current, err := s.options(ctx)
	if err != nil {
		return Settings{}, err
	}
	options := Options{
		IndexerKind:   strings.TrimSpace(update.IndexerKind),
		IndexerURL:    strings.TrimSpace(update.IndexerURL),
		IndexerAPIKey: strings.TrimSpace(update.IndexerAPIKey),
		QBitURL:       strings.TrimSpace(update.QBitURL),
		QBitUsername:  strings.TrimSpace(update.QBitUsername),
		QBitPassword:  update.QBitPassword,
		Category:      strings.TrimSpace(update.QBitCategory),
		DownloadRoot:  strings.TrimSpace(update.QBitDownloadRoot),
	}
	if options.IndexerKind == "" {
		options.IndexerKind = "prowlarr"
	}
	if options.IndexerKind != "prowlarr" && options.IndexerKind != "torznab" {
		return Settings{}, ErrInvalid
	}
	if options.IndexerAPIKey == "" {
		options.IndexerAPIKey = current.IndexerAPIKey
	}
	if options.QBitPassword == "" {
		options.QBitPassword = current.QBitPassword
	}
	if options.Category == "" {
		options.Category = "aldus"
	}
	if _, err := New(options); err != nil {
		return Settings{}, ErrInvalid
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO acquisition_settings (
			id,
			indexer_url,
			indexer_api_key,
			qbittorrent_url,
			qbittorrent_username,
			qbittorrent_password,
			qbittorrent_category,
			indexer_kind,
			qbittorrent_download_root,
			updated_at
		)
		VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET
			indexer_url = excluded.indexer_url,
			indexer_api_key = excluded.indexer_api_key,
			qbittorrent_url = excluded.qbittorrent_url,
			qbittorrent_username = excluded.qbittorrent_username,
			qbittorrent_password = excluded.qbittorrent_password,
			qbittorrent_category = excluded.qbittorrent_category,
			indexer_kind = excluded.indexer_kind,
			qbittorrent_download_root = excluded.qbittorrent_download_root,
			updated_at = excluded.updated_at`,
		options.IndexerURL,
		options.IndexerAPIKey,
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
	return s.Settings(ctx, actor)
}

func (s *Store) options(ctx context.Context) (Options, error) {
	options := s.client.options
	err := s.db.QueryRowContext(ctx, `
		SELECT
			indexer_url,
			indexer_api_key,
			qbittorrent_url,
			qbittorrent_username,
			qbittorrent_password,
			qbittorrent_category,
			indexer_kind,
			qbittorrent_download_root
		FROM acquisition_settings
		WHERE id = 1`,
	).Scan(
		&options.IndexerURL,
		&options.IndexerAPIKey,
		&options.QBitURL,
		&options.QBitUsername,
		&options.QBitPassword,
		&options.Category,
		&options.IndexerKind,
		&options.DownloadRoot,
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
	var status ConnectionStatus
	if client.options.IndexerKind == "prowlarr" {
		indexers, err := client.Indexers(ctx)
		if err != nil {
			status.ProwlarrError = err.Error()
		} else {
			status.ProwlarrOK = true
			for _, indexer := range indexers {
				if indexer.Enabled && indexer.Protocol == "torrent" {
					status.IndexerCount++
				}
			}
		}
	} else {
		_, err := client.Search(ctx, "aldus connection test")
		status.ProwlarrOK = err == nil
		if err != nil {
			status.ProwlarrError = err.Error()
		}
	}
	downloads, err := client.Downloads(ctx)
	if err != nil {
		status.QBitTorrentError = err.Error()
	} else if s.downloadIngress != "" {
		if err := s.validateDownloadIngress(downloads, client.options.DownloadRoot); err != nil {
			status.QBitTorrentError = err.Error()
		} else {
			status.QBitTorrentOK = true
		}
	} else {
		status.QBitTorrentOK = true
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
			return fmt.Errorf("qBittorrent sees %q but Aldus cannot see it at %q; ALDUS_DOWNLOAD_PATH must mount the same host folder: %w", download.ContentPath, mapped, err)
		}
	}
	return nil
}

func (s *Store) Available(ctx context.Context) (bool, error) {
	options, err := s.options(ctx)
	if err != nil {
		return false, err
	}
	return options.IndexerURL != "" && options.QBitURL != "", nil
}

func (s *Store) Destinations(ctx context.Context, actor auth.User) ([]Destination, error) {
	args := append([]any{actor.ID}, auth.LibraryAccessArgs(actor)...)
	rows, err := s.db.QueryContext(ctx, `SELECT l.id,l.name,ls.id,ls.name FROM libraries l JOIN library_sources ls ON ls.library_id=l.id AND ls.enabled=1 AND ls.deleted_at IS NULL LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE `+auth.EffectiveLibraryAccessSQL("l.id")+` AND (? OR m.role IN ('owner','editor') OR m.can_request_acquisitions=1) ORDER BY l.name,ls.name`, append(args, actor.Admin)...)
	if err != nil {
		return nil, fmt.Errorf("list acquisition destinations: %w", err)
	}
	defer rows.Close()
	var values []Destination
	for rows.Next() {
		var value Destination
		if err := rows.Scan(&value.LibraryID, &value.LibraryName, &value.SourceID, &value.SourceName); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

func (s *Store) Tracker(ctx context.Context, actor auth.User) (Tracker, error) {
	var seen string
	if err := s.db.QueryRowContext(ctx, `SELECT acquisition_seen_at FROM users WHERE id=? AND disabled=0`, actor.ID).Scan(&seen); err != nil {
		return Tracker{}, ErrNotFound
	}
	args := append([]any{actor.ID}, auth.LibraryAccessArgs(actor)...)
	rows, err := s.db.QueryContext(ctx, `SELECT r.id,r.library_id,COALESCE(r.requested_by,''),COALESCE(r.source_id,''),r.query,r.status,COALESCE(r.pair_id,''),r.download_state,r.download_error,r.fulfillment_state,COALESCE(r.scan_id,''),COALESCE(r.proposal_id,''),COALESCE(r.work_id,''),COALESCE(r.selected_title,''),COALESCE(r.selected_source,''),COALESCE(r.selected_size,0),COALESCE(r.selected_published_at,''),r.created_at,r.updated_at FROM acquisition_requests r WHERE r.requested_by=? AND r.dismissed_at='' AND `+auth.EffectiveLibraryAccessSQL("r.library_id")+` ORDER BY r.updated_at DESC,r.id LIMIT 100`, args...)
	if err != nil {
		return Tracker{}, fmt.Errorf("list acquisition tracker: %w", err)
	}
	defer rows.Close()
	var tracker Tracker
	for rows.Next() {
		value, err := scanRequest(rows)
		if err != nil {
			return Tracker{}, err
		}
		tracker.Requests = append(tracker.Requests, value)
		if seen == "" || value.UpdatedAt.Format(time.RFC3339Nano) > seen {
			tracker.UnreadCount++
		}
	}
	return tracker, rows.Err()
}

func (s *Store) MarkTrackerSeen(ctx context.Context, actor auth.User) error {
	result, err := s.db.ExecContext(ctx, `UPDATE users SET acquisition_seen_at=? WHERE id=? AND disabled=0`, time.Now().UTC().Format(time.RFC3339Nano), actor.ID)
	if err != nil {
		return fmt.Errorf("mark acquisition tracker seen: %w", err)
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) Retry(ctx context.Context, actor auth.User, libraryID, requestID string) error {
	var selectedURL, scanID, state, torrentHash string
	args := append([]any{actor.ID, requestID, libraryID}, auth.LibraryAccessArgs(actor)...)
	args = append(args, actor.Admin, actor.ID)
	err := s.db.QueryRowContext(ctx, `SELECT r.selected_url,COALESCE(r.scan_id,''),r.fulfillment_state,r.torrent_hash FROM acquisition_requests r LEFT JOIN library_members m ON m.library_id=r.library_id AND m.user_id=? WHERE r.id=? AND r.library_id=? AND `+auth.EffectiveLibraryAccessSQL("r.library_id")+` AND (? OR m.role IN ('owner','editor') OR r.requested_by=?)`, args...).Scan(&selectedURL, &scanID, &state, &torrentHash)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if state != "failed" {
		return ErrInvalid
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if scanID != "" {
		if s.retryScan == nil {
			return ErrUnavailable
		}
		if err := s.retryScan(ctx, scanID, requestID); err != nil {
			return err
		}
		_, err = s.db.ExecContext(ctx, `UPDATE acquisition_requests SET fulfillment_state='scanning',download_error='',dismissed_at='',updated_at=? WHERE id=? AND fulfillment_state='failed'`, now, requestID)
		return err
	}
	if selectedURL == "" {
		return ErrInvalid
	}
	client, err := s.configuredClient(ctx)
	if err != nil {
		return err
	}
	downloads, err := client.Downloads(ctx)
	if err != nil {
		return err
	}
	found := false
	for _, download := range downloads {
		if (torrentHash != "" && strings.EqualFold(download.Hash, torrentHash)) || download.HasTag(requestID) {
			found = true
			torrentHash = download.Hash
			break
		}
	}
	if !found {
		torrentHash, err = client.addTracked(ctx, selectedURL, requestID)
		if torrentHash != "" {
			_, _ = s.db.ExecContext(ctx, `UPDATE acquisition_requests SET torrent_hash=? WHERE id=?`, torrentHash, requestID)
		}
		if err != nil {
			return err
		}
	}
	_, err = s.db.ExecContext(ctx, `UPDATE acquisition_requests SET status='queued',download_state='downloading',fulfillment_state='downloading',download_error='',dismissed_at='',torrent_hash=?,download_last_seen_at='',download_progress=0,download_progress_updated_at=?,updated_at=? WHERE id=? AND fulfillment_state='failed'`, torrentHash, now, now, requestID)
	return err
}

func (s *Store) Cancel(ctx context.Context, actor auth.User, libraryID, requestID string) error {
	var state string
	args := append([]any{actor.ID, requestID, libraryID}, auth.LibraryAccessArgs(actor)...)
	args = append(args, actor.Admin, actor.ID)
	err := s.db.QueryRowContext(ctx, `SELECT r.fulfillment_state FROM acquisition_requests r LEFT JOIN library_members m ON m.library_id=r.library_id AND m.user_id=? WHERE r.id=? AND r.library_id=? AND `+auth.EffectiveLibraryAccessSQL("r.library_id")+` AND (? OR m.role IN ('owner','editor') OR r.requested_by=?)`, args...).Scan(&state)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if state != "submitting" && state != "downloading" {
		return ErrInvalid
	}
	client, err := s.configuredClient(ctx)
	if err != nil {
		return err
	}
	if err := client.CancelTagged(ctx, requestID); err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE acquisition_requests SET fulfillment_state='failed',download_error='Canceled by user.',updated_at=? WHERE id=? AND fulfillment_state IN ('submitting','downloading')`, time.Now().UTC().Format(time.RFC3339Nano), requestID)
	return err
}

func (s *Store) Dismiss(ctx context.Context, actor auth.User, libraryID, requestID string) error {
	args := append([]any{time.Now().UTC().Format(time.RFC3339Nano), time.Now().UTC().Format(time.RFC3339Nano), requestID, libraryID, actor.ID}, auth.LibraryAccessArgs(actor)...)
	args = append(args, actor.Admin, actor.ID)
	result, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET dismissed_at=?,updated_at=? WHERE id=? AND library_id=? AND fulfillment_state IN ('failed','available') AND EXISTS(SELECT 1 FROM libraries l LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE l.id=acquisition_requests.library_id AND `+auth.EffectiveLibraryAccessSQL("l.id")+` AND (? OR m.role IN ('owner','editor') OR acquisition_requests.requested_by=?))`, args...)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return ErrInvalid
	}
	return nil
}

func (s *Store) Start(ctx context.Context) {
	s.startOnce.Do(func() {
		if s.handoff == nil {
			close(s.done)
			return
		}
		go func() {
			defer close(s.done)
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()
			for {
				if err := s.Poll(ctx); err != nil && ctx.Err() == nil {
					slog.Warn("acquisition completion check failed", "diagnosis", err)
				}
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
				}
			}
		}()
	})
}

func (s *Store) Wait() {
	<-s.done
}

func (s *Store) Poll(ctx context.Context) error {
	if s.handoff == nil {
		return nil
	}
	if err := s.recoverSubmissions(ctx); err != nil {
		return err
	}
	if err := s.reconcileFulfillment(ctx); err != nil {
		return err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,library_id,COALESCE(source_id,''),torrent_hash,download_last_seen_at,download_progress,download_progress_updated_at,updated_at FROM acquisition_requests WHERE status='queued' AND fulfillment_state='downloading'`)
	if err != nil {
		return fmt.Errorf("list acquisition downloads: %w", err)
	}
	defer rows.Close()
	var requests []downloadMonitorRequest
	for rows.Next() {
		var value downloadMonitorRequest
		if err := rows.Scan(&value.id, &value.libraryID, &value.sourceID, &value.hash, &value.lastSeen, &value.progress, &value.progressUpdated, &value.updated); err != nil {
			return err
		}
		requests = append(requests, value)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(requests) == 0 {
		return nil
	}
	client, err := s.configuredClient(ctx)
	if err != nil {
		return err
	}
	downloads, err := client.Downloads(ctx)
	if errors.Is(err, ErrUnavailable) {
		return nil
	}
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, request := range requests {
		var download *Download
		for i := range downloads {
			if (request.hash != "" && downloads[i].Hash == request.hash) || downloads[i].HasTag(request.id) {
				download = &downloads[i]
				break
			}
		}
		failed, err := s.monitorDownload(ctx, request, download, now)
		if err != nil {
			return err
		}
		if download != nil && download.Hash != "" && download.HasTag(request.id) {
			_ = client.RemoveTag(ctx, download.Hash, request.id)
		}
		if failed || download == nil || !download.ReadyForImport() {
			continue
		}
		if request.sourceID == "" {
			s.markDownloadProblem(ctx, request.id, "Choose an Aldus Source for this download.")
			continue
		}
		completedPath, err := s.mapDownloadPath(ctx, request.sourceID, download.ContentPath, client.options.DownloadRoot)
		var scanID string
		if err == nil {
			scanID, err = s.handoff(ctx, request.libraryID, request.sourceID, request.id, completedPath)
		}
		if errors.Is(err, source.ErrActiveScan) {
			continue
		}
		if err != nil {
			s.markDownloadProblem(ctx, request.id, err.Error())
			continue
		}
		var relative string
		if err := s.db.QueryRowContext(ctx, `SELECT managed_relative_path FROM acquisition_requests WHERE id=?`, request.id).Scan(&relative); err != nil {
			return err
		}
		if relative == "" {
			relative, err = s.completedRelativePath(ctx, request.sourceID, completedPath)
		}
		if err != nil {
			return err
		}
		_, err = s.db.ExecContext(ctx, `UPDATE acquisition_requests SET fulfillment_state='scanning',scan_id=?,completed_relative_path=?,download_error='',updated_at=? WHERE id=? AND fulfillment_state='downloading'`, scanID, relative, time.Now().UTC().Format(time.RFC3339Nano), request.id)
		if err != nil {
			return fmt.Errorf("finish acquisition handoff: %w", err)
		}
	}
	return nil
}

func (s *Store) recoverSubmissions(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `SELECT id,selected_url,torrent_hash,updated_at FROM acquisition_requests WHERE fulfillment_state='submitting' ORDER BY created_at,id`)
	if err != nil {
		return fmt.Errorf("list acquisition submissions: %w", err)
	}
	defer rows.Close()
	type submission struct{ id, url, hash, updated string }
	var pending []submission
	for rows.Next() {
		var value submission
		if err := rows.Scan(&value.id, &value.url, &value.hash, &value.updated); err != nil {
			return err
		}
		pending = append(pending, value)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(pending) == 0 {
		return nil
	}
	client, err := s.configuredClient(ctx)
	if err != nil {
		return err
	}
	downloads, err := client.Downloads(ctx)
	if err != nil {
		return err
	}
	for _, value := range pending {
		found := false
		for _, download := range downloads {
			if (value.hash != "" && strings.EqualFold(download.Hash, value.hash)) || download.HasTag(value.id) {
				found = true
				value.hash = download.Hash
				break
			}
		}
		if !found {
			updated, _ := time.Parse(time.RFC3339Nano, value.updated)
			if time.Since(updated) < downloadMissingGrace {
				continue
			}
			hash, err := client.addTracked(ctx, value.url, value.id)
			if hash != "" {
				value.hash = hash
				_, _ = s.db.ExecContext(ctx, `UPDATE acquisition_requests SET torrent_hash=? WHERE id=? AND fulfillment_state='submitting'`, hash, value.id)
			}
			if err != nil {
				if errors.Is(err, ErrSubmissionUnknown) {
					_, _ = s.db.ExecContext(ctx, `UPDATE acquisition_requests SET updated_at=? WHERE id=? AND fulfillment_state='submitting'`, time.Now().UTC().Format(time.RFC3339Nano), value.id)
					continue
				}
				s.markDownloadProblem(ctx, value.id, err.Error())
				continue
			}
		}
		stamp := time.Now().UTC().Format(time.RFC3339Nano)
		if _, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET status='queued',download_state='downloading',fulfillment_state='downloading',download_error='',torrent_hash=?,download_last_seen_at='',download_progress=0,download_progress_updated_at=?,updated_at=? WHERE id=? AND fulfillment_state='submitting'`, value.hash, stamp, stamp, value.id); err != nil {
			return fmt.Errorf("finish recovered acquisition submission: %w", err)
		}
	}
	return nil
}

func (s *Store) completedRelativePath(ctx context.Context, sourceID, completedPath string) (string, error) {
	var root string
	if err := s.db.QueryRowContext(ctx, `SELECT root_path FROM library_sources WHERE id=?`, sourceID).Scan(&root); err != nil {
		return "", err
	}
	relative, err := filepath.Rel(root, completedPath)
	if err != nil || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errors.New("completed download is outside the selected Aldus Source")
	}
	return filepath.ToSlash(relative), nil
}

func (s *Store) reconcileFulfillment(ctx context.Context) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET fulfillment_state='failed',download_state='ready',download_error=COALESCE(NULLIF((SELECT reason FROM acquisition_import_outcomes WHERE acquisition_request_id=acquisition_requests.id),''),'Source scan failed.'),updated_at=? WHERE fulfillment_state IN ('scanning','needs_review') AND EXISTS(SELECT 1 FROM acquisition_import_outcomes o WHERE o.acquisition_request_id=acquisition_requests.id AND o.state='failed')`, now); err != nil {
		return fmt.Errorf("reconcile failed acquisition scans: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET proposal_id=(SELECT proposal_id FROM acquisition_import_outcomes WHERE acquisition_request_id=acquisition_requests.id),fulfillment_state='needs_review',download_state='ready',download_error=(SELECT reason FROM acquisition_import_outcomes WHERE acquisition_request_id=acquisition_requests.id),updated_at=? WHERE fulfillment_state='scanning' AND EXISTS(SELECT 1 FROM acquisition_import_outcomes o WHERE o.acquisition_request_id=acquisition_requests.id AND o.state='needs_review')`, now); err != nil {
		return fmt.Errorf("reconcile completed acquisition scans: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET proposal_id=(SELECT proposal_id FROM acquisition_import_outcomes WHERE acquisition_request_id=acquisition_requests.id),work_id=(SELECT accepted_work_id FROM acquisition_import_outcomes WHERE acquisition_request_id=acquisition_requests.id),fulfillment_state='available',download_state='ready',download_error='',updated_at=? WHERE fulfillment_state IN ('scanning','needs_review') AND EXISTS(SELECT 1 FROM acquisition_import_outcomes o JOIN works w ON w.id=o.accepted_work_id AND w.library_id=acquisition_requests.library_id WHERE o.acquisition_request_id=acquisition_requests.id AND o.state='accepted')`, now); err != nil {
		return fmt.Errorf("reconcile accepted acquisitions: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO user_work_statuses(user_id,work_id,status,updated_at) SELECT requested_by,work_id,'want_to_read',? FROM acquisition_requests WHERE fulfillment_state='available' AND work_id IS NOT NULL AND requested_by IS NOT NULL ON CONFLICT(user_id,work_id) DO NOTHING`, now); err != nil {
		return fmt.Errorf("save acquired work status: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE acquisition_pairs SET work_id=(SELECT work_id FROM acquisition_requests WHERE pair_id=acquisition_pairs.id AND work_id IS NOT NULL LIMIT 1),updated_at=? WHERE work_id IS NULL AND EXISTS(SELECT 1 FROM acquisition_requests WHERE pair_id=acquisition_pairs.id AND work_id IS NOT NULL)`, now); err != nil {
		return fmt.Errorf("reconcile acquisition pair work: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE import_groups SET existing_work_id=(SELECT p.work_id FROM acquisition_requests r JOIN acquisition_pairs p ON p.id=r.pair_id WHERE r.proposal_id=import_groups.id AND p.work_id IS NOT NULL LIMIT 1),updated_at=? WHERE decision='' AND EXISTS(SELECT 1 FROM acquisition_requests r JOIN acquisition_pairs p ON p.id=r.pair_id WHERE r.proposal_id=import_groups.id AND p.work_id IS NOT NULL)`, now); err != nil {
		return fmt.Errorf("reconcile paired import target: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO work_metadata(work_id,isbn,first_publish_year,cover_url,description,source,updated_at) SELECT work_id,advisory_isbn,advisory_year,advisory_cover_url,advisory_description,advisory_source,? FROM acquisition_requests WHERE fulfillment_state='available' AND work_id IS NOT NULL AND (advisory_isbn!='' OR advisory_year>0 OR advisory_cover_url!='' OR advisory_description!='') ON CONFLICT(work_id) DO UPDATE SET isbn=CASE WHEN work_metadata.isbn='' THEN excluded.isbn ELSE work_metadata.isbn END,first_publish_year=CASE WHEN work_metadata.first_publish_year=0 THEN excluded.first_publish_year ELSE work_metadata.first_publish_year END,cover_url=CASE WHEN work_metadata.cover_url='' THEN excluded.cover_url ELSE work_metadata.cover_url END,description=CASE WHEN work_metadata.description='' THEN excluded.description ELSE work_metadata.description END,source=CASE WHEN work_metadata.source='' THEN excluded.source ELSE work_metadata.source END,updated_at=excluded.updated_at`, now); err != nil {
		return fmt.Errorf("reconcile acquisition metadata: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO work_covers(id,work_id,source,source_id,image_url,created_at) SELECT 'acquisition-'||hex(randomblob(16)),work_id,'open_library',advisory_cover_id,advisory_cover_url,? FROM acquisition_requests WHERE fulfillment_state='available' AND work_id IS NOT NULL AND advisory_cover_id!='' AND advisory_cover_url!='' ON CONFLICT(work_id,source,source_id) DO NOTHING`, now); err != nil {
		return fmt.Errorf("save acquisition covers: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE works SET selected_cover_id=(SELECT c.id FROM work_covers c WHERE c.work_id=works.id AND c.source='open_library' ORDER BY c.created_at,c.id LIMIT 1),updated_at=? WHERE selected_cover_id IS NULL AND EXISTS(SELECT 1 FROM work_covers c WHERE c.work_id=works.id AND c.source='open_library')`, now); err != nil {
		return fmt.Errorf("select acquisition covers: %w", err)
	}
	if s.pairHandoff != nil {
		rows, err := s.db.QueryContext(ctx, `SELECT p.id,COALESCE(p.requested_by,''),em.id,em.sha256,am.id,am.sha256 FROM acquisition_pairs p JOIN acquisition_requests er ON er.pair_id=p.id AND er.fulfillment_state='available' JOIN import_items ei ON ei.group_id=er.proposal_id AND ei.representation_kind='epub' JOIN media_locations el ON el.source_entry_id=ei.source_entry_id JOIN media em ON em.id=el.media_id AND em.kind='epub' JOIN acquisition_requests ar ON ar.pair_id=p.id AND ar.fulfillment_state='available' JOIN import_items ai ON ai.group_id=ar.proposal_id AND ai.representation_kind='audiobook' JOIN media_locations al ON al.source_entry_id=ai.source_entry_id JOIN media am ON am.id=al.media_id AND am.kind IN ('audio','audiobook') WHERE er.work_id=ar.work_id`)
		if err != nil {
			return fmt.Errorf("find completed acquisition pairs: %w", err)
		}
		var pairs []ReadyPair
		for rows.Next() {
			var pair ReadyPair
			if err := rows.Scan(&pair.ID, &pair.RequestedBy, &pair.EPUBMediaID, &pair.EPUBSHA256, &pair.AudioMediaID, &pair.AudioSHA256); err != nil {
				rows.Close()
				return err
			}
			pairs = append(pairs, pair)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, pair := range pairs {
			if err := s.pairHandoff(ctx, pair); err != nil {
				slog.Warn("paired acquisition alignment unavailable", "pair_id", pair.ID, "error", err)
			}
		}
	}
	return nil
}

func (s *Store) mapDownloadPath(ctx context.Context, sourceID, completedPath, remoteRoot string) (string, error) {
	var storageKind, sourceRoot string
	if err := s.db.QueryRowContext(ctx, `SELECT storage_kind,root_path FROM library_sources WHERE id=? AND enabled=1 AND deleted_at IS NULL`, sourceID).Scan(&storageKind, &sourceRoot); err != nil {
		return "", errors.New("selected Aldus Source is unavailable")
	}
	mapped := completedPath
	if remoteRoot != "" {
		relative, err := relativeDownloadPath(completedPath, remoteRoot)
		if err != nil {
			return "", err
		}
		if storageKind == "managed" {
			if s.downloadIngress != "" {
				mapped = filepath.Join(s.downloadIngress, filepath.FromSlash(relative))
			}
		} else {
			mapped = filepath.Join(sourceRoot, filepath.FromSlash(relative))
		}
	}
	if storageKind == "managed" && s.downloadIngress != "" {
		if _, err := os.Stat(mapped); err != nil {
			return "", fmt.Errorf("completed download %q is not visible to Aldus at %q; mount the qBittorrent download folder at %q: %w", completedPath, mapped, s.downloadIngress, err)
		}
	}
	return mapped, nil
}

func relativeDownloadPath(completedPath, remoteRoot string) (string, error) {
	normalize := func(value string) string { return path.Clean(strings.ReplaceAll(value, `\`, "/")) }
	root, completed := normalize(remoteRoot), normalize(completedPath)
	if completed != root && !strings.HasPrefix(completed, strings.TrimSuffix(root, "/")+"/") {
		return "", fmt.Errorf("qBittorrent reported %q outside its configured download root %q", completedPath, remoteRoot)
	}
	return strings.TrimPrefix(strings.TrimPrefix(completed, root), "/"), nil
}

func (s *Store) markDownloadProblem(ctx context.Context, id, diagnosis string) {
	diagnosis = strings.TrimSpace(diagnosis)
	if len(diagnosis) > 500 {
		diagnosis = diagnosis[:500]
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE acquisition_requests SET fulfillment_state='failed',download_error=?,updated_at=? WHERE id=?`, diagnosis, time.Now().UTC().Format(time.RFC3339Nano), id)
}

func (s *Store) Create(ctx context.Context, actor auth.User, libraryID, sourceID, query string) (Request, error) {
	query = strings.TrimSpace(query)
	if query == "" || len(query) > 500 {
		return Request{}, ErrInvalid
	}
	id, err := randomID()
	if err != nil {
		return Request{}, err
	}
	now := time.Now().UTC()
	stamp := now.Format(time.RFC3339Nano)
	args := []any{id, actor.ID, query, stamp, stamp, sourceID, actor.ID, libraryID}
	args = append(args, auth.LibraryAccessArgs(actor)...)
	args = append(args, actor.Admin)
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,created_at,updated_at)
		SELECT ?,l.id,?,ls.id,?,'requested',?,?
		FROM libraries l JOIN library_sources ls ON ls.library_id=l.id AND ls.id=? AND ls.enabled=1 AND ls.deleted_at IS NULL
		LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=?
		WHERE l.id=? AND `+auth.EffectiveLibraryAccessSQL("l.id")+` AND (? OR m.role IN ('owner','editor') OR m.can_request_acquisitions=1)`, args...)
	if err != nil {
		return Request{}, fmt.Errorf("create acquisition request: %w", err)
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return Request{}, ErrNotFound
	}
	return Request{ID: id, LibraryID: libraryID, RequestedBy: actor.ID, SourceID: sourceID, Query: query, Status: "requested", FulfillmentState: "awaiting_selection", CreatedAt: now, UpdatedAt: now}, nil
}

func (s *Store) List(ctx context.Context, actor auth.User, libraryID string) ([]Request, error) {
	args := append([]any{actor.ID, libraryID}, auth.LibraryEditArgs(actor)...)
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.id,r.library_id,COALESCE(r.requested_by,''),COALESCE(r.source_id,''),r.query,r.status,COALESCE(r.pair_id,''),r.download_state,r.download_error,r.fulfillment_state,COALESCE(r.scan_id,''),COALESCE(r.proposal_id,''),COALESCE(r.work_id,''),
			COALESCE(r.selected_title,''),COALESCE(r.selected_source,''),COALESCE(r.selected_size,0),
			COALESCE(r.selected_published_at,''),r.created_at,r.updated_at
		FROM acquisition_requests r
		JOIN libraries l ON l.id=r.library_id
		LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=?
		WHERE r.library_id=? AND `+auth.EffectiveLibraryEditSQL("r.library_id", "m")+`
		ORDER BY r.created_at DESC,r.id`, args...)
	if err != nil {
		return nil, fmt.Errorf("list acquisition requests: %w", err)
	}
	defer rows.Close()
	var values []Request
	for rows.Next() {
		value, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read acquisition requests: %w", err)
	}
	if values == nil {
		if err := s.authorizeLibrary(ctx, actor, libraryID); err != nil {
			return nil, err
		}
	}
	return values, nil
}

func (s *Store) Search(ctx context.Context, actor auth.User, libraryID, id string) ([]SearchResult, error) {
	query, err := s.authorizedQuery(ctx, actor, libraryID, id)
	if err != nil {
		return nil, err
	}
	client, err := s.configuredClient(ctx)
	if err != nil {
		return nil, err
	}
	results, err := client.Search(ctx, query)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin acquisition search: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM acquisition_results WHERE request_id=?`, id); err != nil {
		return nil, fmt.Errorf("replace acquisition results: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	discovery := normalizeSearchResults(query, results)
	metadata := s.searchMetadata(ctx, client, query)
	stored := make([]SearchResult, 0, len(discovery))
	for _, item := range discovery {
		result := item.Result
		resultID, err := randomID()
		if err != nil {
			return nil, err
		}
		published := ""
		if !result.Published.IsZero() {
			published = result.Published.UTC().Format(time.RFC3339Nano)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO acquisition_results(id,request_id,title,download_url,source,size,published_at,created_at) VALUES(?,?,?,?,?,?,NULLIF(?,''),?)`, resultID, id, result.Title, result.DownloadURL, result.Source, max(0, result.Size), published, now); err != nil {
			return nil, fmt.Errorf("store acquisition result: %w", err)
		}
		_, _, _, _, abridged := releaseMetadata(result.Title)
		value := SearchResult{ID: resultID, Title: result.Title, Source: result.Source, Size: max(0, result.Size), Published: result.Published, CanonicalTitle: item.CanonicalTitle, Author: item.Author, Language: item.Language, Format: item.Format, Kind: item.Kind, Edition: item.Edition, Narrator: item.Narrator, GroupKey: item.GroupKey, Match: item.Match, Relevance: item.Relevance, Abridged: abridged, downloadURL: result.DownloadURL}
		if match := matchingMetadata(value.CanonicalTitle, value.Author, metadata); match.Title != "" {
			value.CanonicalTitle, value.Year, value.ISBN, value.CoverID, value.CoverURL, value.Description, value.OpenLibraryID = match.Title, match.Year, match.ISBN, match.CoverID, match.CoverURL, match.Description, match.ID
			if value.Author == "" {
				value.Author = match.Author
			}
		}
		stored = append(stored, value)
	}
	addLikelyPairs(stored)
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit acquisition search: %w", err)
	}
	return stored, nil
}

func (s *Store) Discover(ctx context.Context, actor auth.User, libraryID, sourceID, query string) (Discovery, error) {
	request, err := s.Create(ctx, actor, libraryID, sourceID, query)
	if err != nil {
		return Discovery{}, err
	}
	defer s.db.ExecContext(context.WithoutCancel(ctx), `DELETE FROM acquisition_requests WHERE id=?`, request.ID)
	results, err := s.Search(ctx, actor, libraryID, request.ID)
	if err != nil {
		return Discovery{}, err
	}
	stored := make(map[string]selectedDiscoveryResult, len(results))
	for _, result := range results {
		var value Result
		var published string
		if err := s.db.QueryRowContext(ctx, `SELECT title,download_url,source,size,COALESCE(published_at,'') FROM acquisition_results WHERE id=? AND request_id=?`, result.ID, request.ID).Scan(&value.Title, &value.DownloadURL, &value.Source, &value.Size, &published); err != nil {
			return Discovery{}, fmt.Errorf("read discovery result: %w", err)
		}
		value.Published, _ = time.Parse(time.RFC3339Nano, published)
		stored[result.ID] = selectedDiscoveryResult{Download: value, Metadata: result}
	}
	id, err := randomID()
	if err != nil {
		return Discovery{}, err
	}
	now := time.Now()
	s.discoveryMu.Lock()
	for key, value := range s.discoveries {
		if now.After(value.ExpiresAt) {
			delete(s.discoveries, key)
		}
	}
	s.discoveries[id] = discoverySession{LibraryID: libraryID, SourceID: sourceID, Query: strings.TrimSpace(query), UserID: actor.ID, ExpiresAt: now.Add(15 * time.Minute), Results: stored}
	s.discoveryMu.Unlock()
	return Discovery{ID: id, Results: results}, nil
}

func (s *Store) SelectDiscovery(ctx context.Context, actor auth.User, libraryID, discoveryID, resultID string) (Request, error) {
	s.discoveryMu.Lock()
	discovery, ok := s.discoveries[discoveryID]
	result, resultOK := discovery.Results[resultID]
	if ok && resultOK {
		delete(discovery.Results, resultID)
		s.discoveries[discoveryID] = discovery
	}
	s.discoveryMu.Unlock()
	if !ok || !resultOK || time.Now().After(discovery.ExpiresAt) || discovery.LibraryID != libraryID || discovery.UserID != actor.ID {
		return Request{}, ErrNotFound
	}
	if result.Metadata.Description == "" && result.Metadata.OpenLibraryID != "" {
		result.Metadata.Description, _ = s.client.workDescription(ctx, result.Metadata.OpenLibraryID)
	}
	request, err := s.Create(ctx, actor, libraryID, discovery.SourceID, discovery.Query)
	if err != nil {
		return Request{}, err
	}
	published := ""
	if !result.Download.Published.IsZero() {
		published = result.Download.Published.UTC().Format(time.RFC3339Nano)
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO acquisition_results(id,request_id,title,download_url,source,size,published_at,created_at) VALUES(?,?,?,?,?,?,NULLIF(?,''),?)`, resultID, request.ID, result.Download.Title, result.Download.DownloadURL, result.Download.Source, max(0, result.Download.Size), published, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return Request{}, fmt.Errorf("persist selected discovery result: %w", err)
	}
	if err := s.persistAdvisory(ctx, request.ID, "", result.Metadata); err != nil {
		return Request{}, err
	}
	return s.Select(ctx, actor, libraryID, request.ID, resultID)
}

func (s *Store) SelectPairDiscovery(ctx context.Context, actor auth.User, libraryID, discoveryID string, resultIDs []string) (Pair, error) {
	if len(resultIDs) != 2 || resultIDs[0] == resultIDs[1] {
		return Pair{}, ErrInvalid
	}
	if err := s.authorizeLibrary(ctx, actor, libraryID); err != nil {
		return Pair{}, err
	}
	s.discoveryMu.Lock()
	discovery, ok := s.discoveries[discoveryID]
	first, firstOK := discovery.Results[resultIDs[0]]
	second, secondOK := discovery.Results[resultIDs[1]]
	valid := ok && firstOK && secondOK && discovery.LibraryID == libraryID && discovery.UserID == actor.ID && time.Now().Before(discovery.ExpiresAt) && first.Metadata.Kind != second.Metadata.Kind && slices.Contains(first.Metadata.LikelyPairIDs, resultIDs[1])
	if valid {
		delete(discovery.Results, resultIDs[0])
		delete(discovery.Results, resultIDs[1])
		s.discoveries[discoveryID] = discovery
	}
	s.discoveryMu.Unlock()
	if !valid {
		return Pair{}, ErrNotFound
	}
	for _, selected := range []*selectedDiscoveryResult{&first, &second} {
		if selected.Metadata.Description == "" && selected.Metadata.OpenLibraryID != "" {
			selected.Metadata.Description, _ = s.client.workDescription(ctx, selected.Metadata.OpenLibraryID)
		}
	}
	pairID, err := randomID()
	if err != nil {
		return Pair{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Pair{}, fmt.Errorf("begin acquisition pair: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO acquisition_pairs(id,library_id,requested_by,query,created_at,updated_at) VALUES(?,?,?,?,?,?)`, pairID, libraryID, actor.ID, discovery.Query, now, now); err != nil {
		return Pair{}, fmt.Errorf("create acquisition pair: %w", err)
	}
	requestIDs := make([]string, 2)
	for index, selected := range []selectedDiscoveryResult{first, second} {
		requestID, err := randomID()
		if err != nil {
			return Pair{}, err
		}
		requestIDs[index] = requestID
		args := []any{requestID, actor.ID, discovery.Query, pairID, selected.Metadata.CanonicalTitle, selected.Metadata.Author, selected.Metadata.ISBN, max(0, selected.Metadata.Year), selected.Metadata.CoverID, selected.Metadata.CoverURL, selected.Metadata.Description, "open_library", now, now, discovery.SourceID, actor.ID, libraryID}
		args = append(args, auth.LibraryAccessArgs(actor)...)
		args = append(args, actor.Admin)
		result, err := tx.ExecContext(ctx, `INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,pair_id,advisory_title,advisory_author,advisory_isbn,advisory_year,advisory_cover_id,advisory_cover_url,advisory_description,advisory_source,created_at,updated_at) SELECT ?,l.id,?,ls.id,?,'requested',?,?,?,?,?,?,?,?,?,?,? FROM libraries l JOIN library_sources ls ON ls.library_id=l.id AND ls.id=? AND ls.enabled=1 AND ls.deleted_at IS NULL LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE l.id=? AND `+auth.EffectiveLibraryAccessSQL("l.id")+` AND (? OR m.role IN ('owner','editor') OR m.can_request_acquisitions=1)`, args...)
		if err != nil {
			return Pair{}, fmt.Errorf("create paired acquisition request: %w", err)
		}
		if count, _ := result.RowsAffected(); count != 1 {
			return Pair{}, ErrNotFound
		}
		published := ""
		if !selected.Download.Published.IsZero() {
			published = selected.Download.Published.UTC().Format(time.RFC3339Nano)
		}
		resultID := resultIDs[index]
		if _, err := tx.ExecContext(ctx, `INSERT INTO acquisition_results(id,request_id,title,download_url,source,size,published_at,created_at) VALUES(?,?,?,?,?,?,NULLIF(?,''),?)`, resultID, requestID, selected.Download.Title, selected.Download.DownloadURL, selected.Download.Source, max(0, selected.Download.Size), published, now); err != nil {
			return Pair{}, fmt.Errorf("persist paired discovery result: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return Pair{}, fmt.Errorf("commit acquisition pair: %w", err)
	}
	for index, requestID := range requestIDs {
		_, _ = s.Select(ctx, actor, libraryID, requestID, resultIDs[index])
	}
	requests, err := s.List(ctx, actor, libraryID)
	if err != nil {
		return Pair{}, err
	}
	pair := Pair{ID: pairID}
	for _, request := range requests {
		if request.PairID == pairID {
			pair.Requests = append(pair.Requests, request)
		}
	}
	if len(pair.Requests) != 2 {
		return Pair{}, fmt.Errorf("load acquisition pair: %w", ErrNotFound)
	}
	return pair, nil
}

func (s *Store) persistAdvisory(ctx context.Context, requestID, pairID string, result SearchResult) error {
	_, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET pair_id=NULLIF(?,''),advisory_title=?,advisory_author=?,advisory_isbn=?,advisory_year=?,advisory_cover_id=?,advisory_cover_url=?,advisory_description=?,advisory_source=? WHERE id=?`, pairID, result.CanonicalTitle, result.Author, result.ISBN, max(0, result.Year), result.CoverID, result.CoverURL, result.Description, "open_library", requestID)
	if err != nil {
		return fmt.Errorf("persist acquisition metadata: %w", err)
	}
	return nil
}

func (s *Store) Select(ctx context.Context, actor auth.User, libraryID, requestID, resultID string) (Request, error) {
	if strings.TrimSpace(resultID) == "" {
		return Request{}, ErrInvalid
	}
	// Aldus runs one acquisition worker. Serializing this short administrative
	// path prevents two retries from adding the same release before state is saved.
	s.selectMu.Lock()
	defer s.selectMu.Unlock()
	if _, err := s.authorizedSelectableQuery(ctx, actor, libraryID, requestID); err != nil {
		return Request{}, err
	}
	var result Result
	var published string
	err := s.db.QueryRowContext(ctx, `SELECT title,download_url,source,size,COALESCE(published_at,'') FROM acquisition_results WHERE id=? AND request_id=?`, resultID, requestID).Scan(&result.Title, &result.DownloadURL, &result.Source, &result.Size, &published)
	if errors.Is(err, sql.ErrNoRows) {
		return Request{}, ErrNotFound
	}
	if err != nil {
		return Request{}, fmt.Errorf("get acquisition result: %w", err)
	}
	result.Published, _ = time.Parse(time.RFC3339Nano, published)
	now := time.Now().UTC()
	resultUpdate, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET fulfillment_state='submitting',download_error='',selected_title=?,selected_url=?,selected_source=?,selected_size=?,selected_published_at=NULLIF(?,''),updated_at=? WHERE id=? AND library_id=? AND status='requested' AND fulfillment_state='awaiting_selection'`, result.Title, result.DownloadURL, result.Source, result.Size, published, now.Format(time.RFC3339Nano), requestID, libraryID)
	if err != nil {
		return Request{}, fmt.Errorf("claim acquisition submission: %w", err)
	}
	if changed, _ := resultUpdate.RowsAffected(); changed != 1 {
		return Request{}, ErrNotFound
	}
	client, err := s.configuredClient(ctx)
	if err != nil {
		return Request{}, err
	}
	hash, addErr := client.addTracked(ctx, result.DownloadURL, requestID)
	if hash != "" {
		_, _ = s.db.ExecContext(ctx, `UPDATE acquisition_requests SET torrent_hash=? WHERE id=? AND fulfillment_state='submitting'`, hash, requestID)
	}
	if addErr != nil && errors.Is(addErr, ErrSubmissionUnknown) {
		downloads, listErr := client.Downloads(ctx)
		if listErr == nil {
			for _, download := range downloads {
				if (hash != "" && strings.EqualFold(download.Hash, hash)) || download.HasTag(requestID) {
					hash, addErr = download.Hash, nil
					break
				}
			}
		}
	}
	if addErr != nil {
		if errors.Is(addErr, ErrSubmissionUnknown) {
			return s.request(ctx, requestID)
		}
		s.blacklistRelease(ctx, requestID, hash, addErr.Error())
		s.markDownloadProblem(ctx, requestID, addErr.Error())
		return Request{}, addErr
	}
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `UPDATE acquisition_requests SET status='queued',download_state='downloading',fulfillment_state='downloading',download_error='',torrent_hash=?,download_last_seen_at='',download_progress=0,download_progress_updated_at=?,updated_at=? WHERE id=? AND fulfillment_state='submitting'`, hash, stamp, stamp, requestID)
	if err != nil {
		return Request{}, fmt.Errorf("finish acquisition submission: %w", err)
	}
	return s.request(ctx, requestID)
}

func (s *Store) blacklistRelease(ctx context.Context, acquisitionRequestID, hash, reason string) {
	_, _ = s.db.ExecContext(ctx, `
		INSERT INTO acquisition_release_failures(title_request_id,format,download_url,info_hash,reason,failed_at)
		SELECT f.title_request_id,f.format,a.selected_url,?,?,?
		FROM title_request_formats f JOIN acquisition_requests a ON a.id=f.legacy_acquisition_request_id
		WHERE a.id=? AND a.selected_url!=''
		ON CONFLICT(title_request_id,format,download_url) DO UPDATE SET info_hash=excluded.info_hash,reason=excluded.reason,failed_at=excluded.failed_at`, hash, reason, time.Now().UTC().Format(time.RFC3339Nano), acquisitionRequestID)
}

func (s *Store) request(ctx context.Context, id string) (Request, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id,library_id,COALESCE(requested_by,''),COALESCE(source_id,''),query,status,COALESCE(pair_id,''),download_state,download_error,fulfillment_state,COALESCE(scan_id,''),COALESCE(proposal_id,''),COALESCE(work_id,''),
			COALESCE(selected_title,''),COALESCE(selected_source,''),COALESCE(selected_size,0),COALESCE(selected_published_at,''),created_at,updated_at
		FROM acquisition_requests WHERE id=?`, id)
	value, err := scanRequest(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Request{}, ErrNotFound
	}
	return value, err
}

func (s *Store) authorizedSelectableQuery(ctx context.Context, actor auth.User, libraryID, id string) (string, error) {
	var query string
	args := append([]any{actor.ID, id, libraryID}, auth.LibraryAccessArgs(actor)...)
	args = append(args, actor.Admin, actor.ID)
	err := s.db.QueryRowContext(ctx, `SELECT r.query FROM acquisition_requests r JOIN libraries l ON l.id=r.library_id LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE r.id=? AND r.library_id=? AND r.status='requested' AND r.fulfillment_state='awaiting_selection' AND `+auth.EffectiveLibraryAccessSQL("l.id")+` AND (? OR m.role IN ('owner','editor') OR (m.can_request_acquisitions=1 AND r.requested_by=?))`, args...).Scan(&query)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("authorize selectable acquisition request: %w", err)
	}
	return query, nil
}

func (s *Store) authorizeLibrary(ctx context.Context, actor auth.User, libraryID string) error {
	var allowed bool
	args := []any{actor.ID, libraryID}
	args = append(args, auth.LibraryAccessArgs(actor)...)
	args = append(args, actor.Admin)
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM libraries l LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE l.id=? AND `+auth.EffectiveLibraryAccessSQL("l.id")+` AND (? OR m.role IN ('owner','editor') OR m.can_request_acquisitions=1))`, args...).Scan(&allowed)
	if err != nil {
		return fmt.Errorf("authorize acquisition library: %w", err)
	}
	if !allowed {
		return ErrNotFound
	}
	return nil
}

func (s *Store) authorizedQuery(ctx context.Context, actor auth.User, libraryID, id string) (string, error) {
	var query string
	args := append([]any{actor.ID, id, libraryID}, auth.LibraryAccessArgs(actor)...)
	args = append(args, actor.Admin, actor.ID)
	err := s.db.QueryRowContext(ctx, `SELECT r.query FROM acquisition_requests r JOIN libraries l ON l.id=r.library_id LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE r.id=? AND r.library_id=? AND `+auth.EffectiveLibraryAccessSQL("l.id")+` AND (? OR m.role IN ('owner','editor') OR (m.can_request_acquisitions=1 AND r.requested_by=?))`, args...).Scan(&query)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("authorize acquisition request: %w", err)
	}
	return query, nil
}

type rowScanner interface{ Scan(...any) error }

func scanRequest(row rowScanner) (Request, error) {
	var value Request
	var published, created, updated string
	if err := row.Scan(&value.ID, &value.LibraryID, &value.RequestedBy, &value.SourceID, &value.Query, &value.Status, &value.PairID, &value.DownloadState, &value.DownloadError, &value.FulfillmentState, &value.ScanID, &value.ProposalID, &value.WorkID, &value.SelectedTitle, &value.SelectedSource, &value.SelectedSize, &published, &created, &updated); err != nil {
		return Request{}, fmt.Errorf("scan acquisition request: %w", err)
	}
	value.SelectedPublished, _ = time.Parse(time.RFC3339Nano, published)
	value.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return value, nil
}

func randomID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("generate acquisition ID: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(value[:]), nil
}
