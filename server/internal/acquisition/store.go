package acquisition

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"path"
	"path/filepath"
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
	IndexerKind, IndexerURL, QBitURL, QBitUsername, QBitCategory, QBitDownloadRoot string
	HasIndexerAPIKey, HasQBitPassword                                              bool
}

type SettingsUpdate struct {
	IndexerKind, IndexerURL, IndexerAPIKey, QBitURL, QBitUsername, QBitPassword, QBitCategory, QBitDownloadRoot string
}

type ConnectionStatus struct {
	ProwlarrOK, QBitTorrentOK       bool
	IndexerCount                    int
	ProwlarrError, QBitTorrentError string
}

type Request struct {
	ID, LibraryID, RequestedBy, SourceID, Query, Status string
	DownloadState, DownloadError                        string
	FulfillmentState, ScanID, ProposalID, WorkID        string
	SelectedTitle, SelectedSource                       string
	SelectedSize                                        int64
	SelectedPublished, CreatedAt, UpdatedAt             time.Time
}

type SearchResult struct {
	ID, Title, Source, CanonicalTitle, Author, Language, Format, Kind, Edition, Narrator, GroupKey, Match string
	ISBN, CoverURL, MatchConfidence                                                                       string
	MatchReasons, LikelyPairIDs                                                                           []string
	Size                                                                                                  int64
	Published                                                                                             time.Time
	Relevance, Year                                                                                       int
	Abridged                                                                                              bool
}

type Store struct {
	db            *sql.DB
	client        *Client
	handoff       func(context.Context, string, string, string, string) (string, error)
	selectMu      sync.Mutex
	metadataMu    sync.Mutex
	metadataCache map[string]cachedMetadata
}

func NewStore(db *sql.DB, client *Client) *Store {
	return &Store{db: db, client: client, metadataCache: make(map[string]cachedMetadata)}
}

func (s *Store) SetHandoff(handoff func(context.Context, string, string, string, string) (string, error)) {
	s.handoff = handoff
}

func (s *Store) Settings(ctx context.Context, actor auth.User) (Settings, error) {
	if !actor.Admin {
		return Settings{}, ErrForbidden
	}
	options, err := s.options(ctx)
	if err != nil {
		return Settings{}, err
	}
	return Settings{IndexerKind: options.IndexerKind, IndexerURL: options.IndexerURL, QBitURL: options.QBitURL, QBitUsername: options.QBitUsername, QBitCategory: options.Category, QBitDownloadRoot: options.DownloadRoot, HasIndexerAPIKey: options.IndexerAPIKey != "", HasQBitPassword: options.QBitPassword != ""}, nil
}

func (s *Store) UpdateSettings(ctx context.Context, actor auth.User, update SettingsUpdate) (Settings, error) {
	if !actor.Admin {
		return Settings{}, ErrForbidden
	}
	current, err := s.options(ctx)
	if err != nil {
		return Settings{}, err
	}
	options := Options{IndexerKind: strings.TrimSpace(update.IndexerKind), IndexerURL: strings.TrimSpace(update.IndexerURL), IndexerAPIKey: strings.TrimSpace(update.IndexerAPIKey), QBitURL: strings.TrimSpace(update.QBitURL), QBitUsername: strings.TrimSpace(update.QBitUsername), QBitPassword: update.QBitPassword, Category: strings.TrimSpace(update.QBitCategory), DownloadRoot: strings.TrimSpace(update.QBitDownloadRoot)}
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
	_, err = s.db.ExecContext(ctx, `INSERT INTO acquisition_settings(id,indexer_url,indexer_api_key,qbittorrent_url,qbittorrent_username,qbittorrent_password,qbittorrent_category,indexer_kind,qbittorrent_download_root,updated_at) VALUES(1,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET indexer_url=excluded.indexer_url,indexer_api_key=excluded.indexer_api_key,qbittorrent_url=excluded.qbittorrent_url,qbittorrent_username=excluded.qbittorrent_username,qbittorrent_password=excluded.qbittorrent_password,qbittorrent_category=excluded.qbittorrent_category,indexer_kind=excluded.indexer_kind,qbittorrent_download_root=excluded.qbittorrent_download_root,updated_at=excluded.updated_at`, options.IndexerURL, options.IndexerAPIKey, options.QBitURL, options.QBitUsername, options.QBitPassword, options.Category, options.IndexerKind, options.DownloadRoot, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return Settings{}, fmt.Errorf("save acquisition settings: %w", err)
	}
	return s.Settings(ctx, actor)
}

func (s *Store) options(ctx context.Context) (Options, error) {
	options := s.client.options
	err := s.db.QueryRowContext(ctx, `SELECT indexer_url,indexer_api_key,qbittorrent_url,qbittorrent_username,qbittorrent_password,qbittorrent_category,indexer_kind,qbittorrent_download_root FROM acquisition_settings WHERE id=1`).Scan(&options.IndexerURL, &options.IndexerAPIKey, &options.QBitURL, &options.QBitUsername, &options.QBitPassword, &options.Category, &options.IndexerKind, &options.DownloadRoot)
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
	if _, err := client.Downloads(ctx); err != nil {
		status.QBitTorrentError = err.Error()
	} else {
		status.QBitTorrentOK = true
	}
	return status, nil
}

func (s *Store) Available(ctx context.Context) (bool, error) {
	options, err := s.options(ctx)
	if err != nil {
		return false, err
	}
	return options.IndexerURL != "" && options.QBitURL != "", nil
}

func (s *Store) Start(ctx context.Context) {
	if s.handoff == nil {
		return
	}
	go func() {
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
	rows, err := s.db.QueryContext(ctx, `SELECT id,library_id,COALESCE(source_id,'') FROM acquisition_requests WHERE status='queued' AND fulfillment_state='downloading'`)
	if err != nil {
		return fmt.Errorf("list acquisition downloads: %w", err)
	}
	defer rows.Close()
	type pending struct{ id, libraryID, sourceID string }
	var requests []pending
	for rows.Next() {
		var value pending
		if err := rows.Scan(&value.id, &value.libraryID, &value.sourceID); err != nil {
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
	for _, request := range requests {
		for _, download := range downloads {
			if !download.HasTag(request.id) || !download.ReadyForImport() {
				continue
			}
			if request.sourceID == "" {
				s.markDownloadProblem(ctx, request.id, "Choose an Aldus Source for this download.")
				break
			}
			completedPath, err := s.mapDownloadPath(ctx, request.sourceID, download.ContentPath, client.options.DownloadRoot)
			var scanID string
			if err == nil {
				scanID, err = s.handoff(ctx, request.libraryID, request.sourceID, request.id, completedPath)
			}
			if errors.Is(err, source.ErrActiveScan) {
				break
			}
			if err != nil {
				s.markDownloadProblem(ctx, request.id, err.Error())
				break
			}
			relative, err := s.completedRelativePath(ctx, request.sourceID, completedPath)
			if err != nil {
				return err
			}
			_, err = s.db.ExecContext(ctx, `UPDATE acquisition_requests SET fulfillment_state='scanning',scan_id=?,completed_relative_path=?,download_error='',updated_at=? WHERE id=? AND fulfillment_state='downloading'`, scanID, relative, time.Now().UTC().Format(time.RFC3339Nano), request.id)
			if err != nil {
				return fmt.Errorf("finish acquisition handoff: %w", err)
			}
			break
		}
	}
	return nil
}

func (s *Store) recoverSubmissions(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `SELECT id,selected_url FROM acquisition_requests WHERE fulfillment_state='submitting' ORDER BY created_at,id`)
	if err != nil {
		return fmt.Errorf("list acquisition submissions: %w", err)
	}
	defer rows.Close()
	type submission struct{ id, url string }
	var pending []submission
	for rows.Next() {
		var value submission
		if err := rows.Scan(&value.id, &value.url); err != nil {
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
			if download.HasTag(value.id) {
				found = true
				break
			}
		}
		if !found {
			if err := client.AddTracked(ctx, value.url, value.id); err != nil {
				s.markDownloadProblem(ctx, value.id, err.Error())
				continue
			}
		}
		if _, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET status='queued',download_state='downloading',fulfillment_state='downloading',download_error='',updated_at=? WHERE id=? AND fulfillment_state='submitting'`, time.Now().UTC().Format(time.RFC3339Nano), value.id); err != nil {
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
	if _, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET fulfillment_state='failed',download_state='ready',download_error=COALESCE(NULLIF((SELECT error_summary FROM source_scans WHERE id=scan_id),''),'Source scan failed.'),updated_at=? WHERE fulfillment_state='scanning' AND EXISTS(SELECT 1 FROM source_scans WHERE id=scan_id AND state='failed')`, now); err != nil {
		return fmt.Errorf("reconcile failed acquisition scans: %w", err)
	}
	const matchingGroups = `SELECT DISTINCT ii.group_id FROM import_items ii JOIN import_groups g ON g.id=ii.group_id AND g.library_id=acquisition_requests.library_id JOIN source_entries e ON e.id=ii.source_entry_id WHERE e.source_id=acquisition_requests.source_id AND e.last_seen_scan_id=acquisition_requests.scan_id AND (e.relative_path=acquisition_requests.completed_relative_path OR substr(e.relative_path,1,length(acquisition_requests.completed_relative_path)+1)=acquisition_requests.completed_relative_path||'/')`
	if _, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET proposal_id=(`+matchingGroups+` LIMIT 1),fulfillment_state='needs_review',download_state='ready',updated_at=? WHERE fulfillment_state='scanning' AND EXISTS(SELECT 1 FROM source_scans WHERE id=scan_id AND state='completed') AND (SELECT COUNT(*) FROM (`+matchingGroups+`))=1`, now); err != nil {
		return fmt.Errorf("reconcile completed acquisition scans: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET fulfillment_state='failed',download_state='ready',download_error='No supported EPUB or audiobook was found in the completed download.',updated_at=? WHERE fulfillment_state='scanning' AND EXISTS(SELECT 1 FROM source_scans WHERE id=scan_id AND state='completed') AND (SELECT COUNT(*) FROM (`+matchingGroups+`))=0`, now); err != nil {
		return fmt.Errorf("reconcile empty acquisition scans: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET fulfillment_state='failed',download_state='ready',download_error='Multiple books were found in the completed download; review the Source import proposals separately.',updated_at=? WHERE fulfillment_state='scanning' AND EXISTS(SELECT 1 FROM source_scans WHERE id=scan_id AND state='completed') AND (SELECT COUNT(*) FROM (`+matchingGroups+`))>1`, now); err != nil {
		return fmt.Errorf("reconcile ambiguous acquisition scans: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET fulfillment_state='failed',download_error='The import proposal was dismissed during review.',updated_at=? WHERE fulfillment_state='needs_review' AND EXISTS(SELECT 1 FROM import_groups WHERE id=proposal_id AND library_id=acquisition_requests.library_id AND decision='ignored')`, now); err != nil {
		return fmt.Errorf("reconcile ignored acquisitions: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE acquisition_requests SET work_id=(SELECT accepted_work_id FROM import_groups WHERE id=proposal_id AND library_id=acquisition_requests.library_id),fulfillment_state='available',updated_at=? WHERE fulfillment_state='needs_review' AND proposal_id IS NOT NULL AND EXISTS(SELECT 1 FROM import_groups g JOIN works w ON w.id=g.accepted_work_id AND w.library_id=acquisition_requests.library_id WHERE g.id=proposal_id AND g.library_id=acquisition_requests.library_id AND g.decision='accepted')`, now); err != nil {
		return fmt.Errorf("reconcile accepted acquisitions: %w", err)
	}
	return nil
}

func (s *Store) mapDownloadPath(ctx context.Context, sourceID, completedPath, remoteRoot string) (string, error) {
	if remoteRoot == "" {
		return completedPath, nil
	}
	normalize := func(value string) string { return path.Clean(strings.ReplaceAll(value, `\`, "/")) }
	root, completed := normalize(remoteRoot), normalize(completedPath)
	if completed != root && !strings.HasPrefix(completed, strings.TrimSuffix(root, "/")+"/") {
		return "", errors.New("qBittorrent completed outside its configured download root")
	}
	var sourceRoot string
	if err := s.db.QueryRowContext(ctx, `SELECT root_path FROM library_sources WHERE id=? AND enabled=1 AND deleted_at IS NULL`, sourceID).Scan(&sourceRoot); err != nil {
		return "", errors.New("selected Aldus Source is unavailable")
	}
	relative := strings.TrimPrefix(strings.TrimPrefix(completed, root), "/")
	return filepath.Join(sourceRoot, filepath.FromSlash(relative)), nil
}

func (s *Store) markDownloadProblem(ctx context.Context, id, diagnosis string) {
	diagnosis = strings.TrimSpace(diagnosis)
	if len(diagnosis) > 500 {
		diagnosis = diagnosis[:500]
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE acquisition_requests SET download_error=?,updated_at=? WHERE id=?`, diagnosis, time.Now().UTC().Format(time.RFC3339Nano), id)
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
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,created_at,updated_at)
		SELECT ?,l.id,?,ls.id,?,'requested',?,?
		FROM libraries l JOIN library_sources ls ON ls.library_id=l.id AND ls.id=? AND ls.enabled=1 AND ls.deleted_at IS NULL
		LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=?
		WHERE l.id=? AND (? OR m.role IN ('owner','editor'))`,
		id, actor.ID, query, stamp, stamp, sourceID, actor.ID, libraryID, actor.Admin)
	if err != nil {
		return Request{}, fmt.Errorf("create acquisition request: %w", err)
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return Request{}, ErrNotFound
	}
	return Request{ID: id, LibraryID: libraryID, RequestedBy: actor.ID, SourceID: sourceID, Query: query, Status: "requested", FulfillmentState: "awaiting_selection", CreatedAt: now, UpdatedAt: now}, nil
}

func (s *Store) List(ctx context.Context, actor auth.User, libraryID string) ([]Request, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.id,r.library_id,r.requested_by,COALESCE(r.source_id,''),r.query,r.status,r.download_state,r.download_error,r.fulfillment_state,COALESCE(r.scan_id,''),COALESCE(r.proposal_id,''),COALESCE(r.work_id,''),
			COALESCE(r.selected_title,''),COALESCE(r.selected_source,''),COALESCE(r.selected_size,0),
			COALESCE(r.selected_published_at,''),r.created_at,r.updated_at
		FROM acquisition_requests r
		JOIN libraries l ON l.id=r.library_id
		LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=?
		WHERE r.library_id=? AND (? OR m.role IN ('owner','editor'))
		ORDER BY r.created_at DESC,r.id`, actor.ID, libraryID, actor.Admin)
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
		value := SearchResult{ID: resultID, Title: result.Title, Source: result.Source, Size: max(0, result.Size), Published: result.Published, CanonicalTitle: item.CanonicalTitle, Author: item.Author, Language: item.Language, Format: item.Format, Kind: item.Kind, Edition: item.Edition, Narrator: item.Narrator, GroupKey: item.GroupKey, Match: item.Match, Relevance: item.Relevance, Abridged: abridged}
		if match := matchingMetadata(value.CanonicalTitle, value.Author, metadata); match.Title != "" {
			value.CanonicalTitle, value.Year, value.ISBN, value.CoverURL = match.Title, match.Year, match.ISBN, match.CoverURL
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
	if err := client.AddTracked(ctx, result.DownloadURL, requestID); err != nil {
		s.markDownloadProblem(ctx, requestID, err.Error())
		return Request{}, err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE acquisition_requests SET status='queued',download_state='downloading',fulfillment_state='downloading',download_error='',updated_at=? WHERE id=? AND fulfillment_state='submitting'`, time.Now().UTC().Format(time.RFC3339Nano), requestID)
	if err != nil {
		return Request{}, fmt.Errorf("finish acquisition submission: %w", err)
	}
	values, err := s.List(ctx, actor, libraryID)
	if err != nil {
		return Request{}, err
	}
	for _, value := range values {
		if value.ID == requestID {
			return value, nil
		}
	}
	return Request{}, ErrNotFound
}

func (s *Store) authorizedSelectableQuery(ctx context.Context, actor auth.User, libraryID, id string) (string, error) {
	var query string
	err := s.db.QueryRowContext(ctx, `SELECT r.query FROM acquisition_requests r JOIN libraries l ON l.id=r.library_id LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE r.id=? AND r.library_id=? AND r.status='requested' AND r.fulfillment_state='awaiting_selection' AND (? OR m.role IN ('owner','editor'))`, actor.ID, id, libraryID, actor.Admin).Scan(&query)
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
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM libraries l LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE l.id=? AND (? OR m.role IN ('owner','editor')))`, actor.ID, libraryID, actor.Admin).Scan(&allowed)
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
	err := s.db.QueryRowContext(ctx, `SELECT r.query FROM acquisition_requests r JOIN libraries l ON l.id=r.library_id LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE r.id=? AND r.library_id=? AND (? OR m.role IN ('owner','editor'))`, actor.ID, id, libraryID, actor.Admin).Scan(&query)
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
	if err := row.Scan(&value.ID, &value.LibraryID, &value.RequestedBy, &value.SourceID, &value.Query, &value.Status, &value.DownloadState, &value.DownloadError, &value.FulfillmentState, &value.ScanID, &value.ProposalID, &value.WorkID, &value.SelectedTitle, &value.SelectedSource, &value.SelectedSize, &published, &created, &updated); err != nil {
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
