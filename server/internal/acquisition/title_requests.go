package acquisition

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/notification"
)

type TitleRequest struct {
	ID             string
	LibraryID      string
	RequestedBy    string
	WorkID         string
	ExternalSource string
	ExternalID     string
	Title          string
	Author         string
	CoverURL       string
	Formats        []TitleRequestFormat
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type TitleRequestFormat struct {
	Format         string
	State          string
	SourceID       string
	Error          string
	DownloadState  string
	RetryCount     int
	LastSearchedAt time.Time
	NextSearchAt   time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type CreateTitleRequest struct {
	LibraryID      string
	WorkID         string
	ExternalSource string
	ExternalID     string
	Title          string
	Author         string
	CoverURL       string
	Formats        []string
}

type TitleRequestStore struct {
	db            *sql.DB
	acquisitions  *Store
	notifications *notification.Store
}

func NewTitleRequestStore(db *sql.DB) *TitleRequestStore {
	return &TitleRequestStore{db: db}
}

func (s *TitleRequestStore) SetAcquisitionStore(store *Store) {
	s.acquisitions = store
}

func (s *TitleRequestStore) SetNotificationStore(store *notification.Store) {
	s.notifications = store
}

func (s *TitleRequestStore) Start(ctx context.Context) {
	if s.acquisitions == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			if err := s.Poll(ctx); err != nil && ctx.Err() == nil {
				slog.Warn("title request search failed", "error", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

type claimedTitleFormat struct {
	requestID   string
	libraryID   string
	requestedBy string
	title       string
	author      string
	format      string
	sourceID    string
}

func (s *TitleRequestStore) Poll(ctx context.Context) error {
	if s.acquisitions == nil {
		return ErrUnavailable
	}
	if err := s.recoverClaims(ctx); err != nil {
		return err
	}
	if err := s.syncLegacyFulfillment(ctx); err != nil {
		return err
	}
	for range 10 {
		claimed, ok, err := s.claimDueFormat(ctx)
		if err != nil {
			return err
		}
		if !ok {
			return nil
		}
		if err := s.fulfillClaim(ctx, claimed); err != nil {
			if deferErr := s.deferClaim(ctx, claimed, "search_failed", err.Error()); deferErr != nil {
				return errors.Join(err, deferErr)
			}
		}
	}
	return nil
}

func (s *TitleRequestStore) syncLegacyFulfillment(ctx context.Context) error {
	for range 10 {
		var requestID, requestedBy, title, format, current, legacyState, diagnosis string
		err := s.db.QueryRowContext(ctx, `SELECT f.title_request_id,COALESCE(r.requested_by,''),r.title,f.format,f.state,a.fulfillment_state,a.download_error FROM title_request_formats f JOIN title_requests r ON r.id=f.title_request_id JOIN acquisition_requests a ON a.id=f.legacy_acquisition_request_id WHERE f.state IN ('submitting','downloading','scanning','needs_review') AND a.fulfillment_state IN ('downloading','scanning','needs_review','available','failed') AND f.state!=a.fulfillment_state ORDER BY f.updated_at,f.title_request_id,f.format LIMIT 1`).Scan(&requestID, &requestedBy, &title, &format, &current, &legacyState, &diagnosis)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("sync title request fulfillment: %w", err)
		}
		stamp := time.Now().UTC().Format(time.RFC3339Nano)
		eventType, nextSearch := "fulfillment_"+legacyState, ""
		if legacyState == "failed" {
			var tryAnother bool
			if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM acquisition_release_failures WHERE title_request_id=? AND format=?)`, requestID, format).Scan(&tryAnother); err != nil {
				return fmt.Errorf("check failed release: %w", err)
			}
			if tryAnother {
				legacyState, eventType, nextSearch = "awaiting_release", "release_failed", stamp
				diagnosis = "That release could not start. Aldus will try a different match."
			}
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("sync title request fulfillment: %w", err)
		}
		result, err := tx.ExecContext(ctx, `UPDATE title_request_formats SET state=?,error=?,next_search_at=NULLIF(?,''),updated_at=? WHERE title_request_id=? AND format=? AND state=?`, legacyState, diagnosis, nextSearch, stamp, requestID, format, current)
		if err == nil {
			var changed int64
			changed, err = result.RowsAffected()
			if err == nil && changed == 1 {
				err = appendTitleRequestEvent(ctx, tx, requestID, format, eventType, legacyState, "", diagnosis, stamp)
			}
			if err == nil && changed == 1 && (legacyState == "available" || legacyState == "failed") {
				err = s.notifyRequesterTx(ctx, tx, requestID, format, legacyState, title, requestedBy, stamp)
			}
			if err == nil && changed == 1 {
				_, err = tx.ExecContext(ctx, `UPDATE title_requests SET work_id=COALESCE(work_id,(SELECT work_id FROM acquisition_requests WHERE id=(SELECT legacy_acquisition_request_id FROM title_request_formats WHERE title_request_id=? AND format=?))),updated_at=? WHERE id=?`, requestID, format, stamp, requestID)
			}
			if err == nil && changed == 1 {
				err = tx.Commit()
				if err == nil {
					continue
				}
			}
		}
		_ = tx.Rollback()
		if err != nil {
			return fmt.Errorf("sync title request fulfillment: %w", err)
		}
	}
	return nil
}

func (s *TitleRequestStore) recoverClaims(ctx context.Context) error {
	cutoff := time.Now().UTC().Add(-5 * time.Minute).Format(time.RFC3339Nano)
	for range 10 {
		var requestID, requestedBy, title, format, legacyState, updated string
		err := s.db.QueryRowContext(ctx, `SELECT f.title_request_id,COALESCE(r.requested_by,''),r.title,f.format,COALESCE(a.fulfillment_state,''),f.updated_at FROM title_request_formats f JOIN title_requests r ON r.id=f.title_request_id LEFT JOIN acquisition_requests a ON a.id=f.legacy_acquisition_request_id WHERE f.state='searching' AND (a.fulfillment_state IN ('submitting','downloading') OR f.updated_at<=?) ORDER BY f.updated_at,f.title_request_id,f.format LIMIT 1`, cutoff).Scan(&requestID, &requestedBy, &title, &format, &legacyState, &updated)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("find interrupted title request: %w", err)
		}
		nextState, eventType, diagnosis := "awaiting_release", "search_recovered", "Search was interrupted and will retry."
		if legacyState == "submitting" {
			nextState, eventType, diagnosis = "submitting", "submission_recovered", ""
		} else if legacyState == "downloading" {
			nextState, eventType, diagnosis = "downloading", "download_recovered", ""
		}
		stamp := time.Now().UTC().Format(time.RFC3339Nano)
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("recover title request: %w", err)
		}
		result, err := tx.ExecContext(ctx, `UPDATE title_request_formats SET state=?,next_search_at=NULL,error=?,updated_at=? WHERE title_request_id=? AND format=? AND state='searching' AND updated_at=?`, nextState, diagnosis, stamp, requestID, format, updated)
		if err == nil {
			var changed int64
			changed, err = result.RowsAffected()
			if err == nil && changed == 1 {
				err = appendTitleRequestEvent(ctx, tx, requestID, format, eventType, nextState, "", diagnosis, stamp)
			}
			if err == nil && changed == 1 && nextState == "downloading" {
				err = s.notifyRequesterTx(ctx, tx, requestID, format, "downloading", title, requestedBy, stamp)
			}
			if err == nil && changed == 1 {
				err = tx.Commit()
				if err == nil {
					continue
				}
			}
		}
		_ = tx.Rollback()
		if err != nil {
			return fmt.Errorf("recover title request: %w", err)
		}
	}
	return nil
}

func (s *TitleRequestStore) claimDueFormat(ctx context.Context) (claimedTitleFormat, bool, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for {
		var value claimedTitleFormat
		err := s.db.QueryRowContext(ctx, `
			SELECT
				r.id,
				r.library_id,
				COALESCE(r.requested_by, ''),
				r.title,
				r.author,
				f.format,
				COALESCE(f.source_id, '')
			FROM title_requests r
			JOIN title_request_formats f ON f.title_request_id = r.id
			WHERE f.state IN ('wanted', 'awaiting_release')
				AND (f.next_search_at IS NULL OR f.next_search_at <= ?)
			ORDER BY COALESCE(f.next_search_at, ''), f.updated_at, r.id, f.format
			LIMIT 1`,
			now,
		).Scan(
			&value.requestID,
			&value.libraryID,
			&value.requestedBy,
			&value.title,
			&value.author,
			&value.format,
			&value.sourceID,
		)
		if errors.Is(err, sql.ErrNoRows) {
			return claimedTitleFormat{}, false, nil
		}
		if err != nil {
			return claimedTitleFormat{}, false, fmt.Errorf("find due title request: %w", err)
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return claimedTitleFormat{}, false, fmt.Errorf("claim title request: %w", err)
		}
		// The conditional update is the claim: only one poller may move this
		// format from a waiting state into searching.
		result, err := tx.ExecContext(ctx, `
			UPDATE title_request_formats
			SET
				state = 'searching',
				last_searched_at = ?,
				next_search_at = NULL,
				error = '',
				updated_at = ?
			WHERE title_request_id = ?
				AND format = ?
				AND state IN ('wanted', 'awaiting_release')
				AND (next_search_at IS NULL OR next_search_at <= ?)`,
			now,
			now,
			value.requestID,
			value.format,
			now,
		)
		if err == nil {
			var changed int64
			changed, err = result.RowsAffected()
			if err == nil && changed == 1 {
				err = appendTitleRequestEvent(ctx, tx, value.requestID, value.format, "search_started", "searching", "", "", now)
			}
			if err == nil && changed == 1 {
				err = tx.Commit()
				if err == nil {
					return value, true, nil
				}
			}
		}
		_ = tx.Rollback()
		if err != nil {
			return claimedTitleFormat{}, false, fmt.Errorf("claim title request: %w", err)
		}
	}
}

func (s *TitleRequestStore) fulfillClaim(ctx context.Context, value claimedTitleFormat) error {
	policy, err := s.guidedPolicy(ctx, value.libraryID, value.format)
	if err != nil {
		return s.deferClaim(ctx, value, "search_failed", err.Error())
	}
	if value.sourceID == "" {
		return s.deferClaim(ctx, value, "search_failed", "No default source is configured for this format.")
	}
	query := strings.TrimSpace(value.title + " " + value.author)
	actor := auth.User{ID: value.requestedBy, Admin: true}
	var existingID, existingState string
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(f.legacy_acquisition_request_id,''),COALESCE(a.fulfillment_state,'') FROM title_request_formats f LEFT JOIN acquisition_requests a ON a.id=f.legacy_acquisition_request_id WHERE f.title_request_id=? AND f.format=?`, value.requestID, value.format).Scan(&existingID, &existingState); err != nil {
		return fmt.Errorf("check title request download: %w", err)
	}
	if existingID != "" && (existingState == "submitting" || existingState == "downloading") {
		stamp := time.Now().UTC().Format(time.RFC3339Nano)
		_, err := s.db.ExecContext(ctx, `UPDATE title_request_formats SET state=?,error='',next_search_at=NULL,updated_at=? WHERE title_request_id=? AND format=? AND state='searching'`, existingState, stamp, value.requestID, value.format)
		return err
	}
	legacy, err := s.acquisitions.Create(ctx, actor, value.libraryID, value.sourceID, query)
	if err != nil {
		return s.deferClaim(ctx, value, "search_failed", err.Error())
	}
	results, err := s.acquisitions.Search(ctx, actor, value.libraryID, legacy.ID)
	if err != nil {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM acquisition_requests WHERE id=?`, legacy.ID)
		return s.deferClaim(ctx, value, "search_failed", err.Error())
	}
	results = matchingGuidedResults(results, value.title, value.format, policy)
	blocked := make(map[string]bool)
	rows, err := s.db.QueryContext(ctx, `SELECT download_url,info_hash FROM acquisition_release_failures WHERE title_request_id=? AND format=? AND failed_at>=?`, value.requestID, value.format, time.Now().UTC().Add(-24*time.Hour).Format(time.RFC3339Nano))
	if err != nil {
		return s.deferClaim(ctx, value, "search_failed", err.Error())
	}
	for rows.Next() {
		var downloadURL, hash string
		if err := rows.Scan(&downloadURL, &hash); err != nil {
			rows.Close()
			return s.deferClaim(ctx, value, "search_failed", err.Error())
		}
		blocked[downloadURL] = true
		blocked[hash] = hash != ""
	}
	if err := rows.Close(); err != nil {
		return s.deferClaim(ctx, value, "search_failed", err.Error())
	}
	results = slices.DeleteFunc(results, func(result SearchResult) bool {
		return blocked[result.downloadURL] || blocked[magnetInfoHash(result.downloadURL)]
	})
	if len(results) == 0 {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM acquisition_requests WHERE id=?`, legacy.ID)
		return s.deferClaim(ctx, value, "no_match", "No release currently matches the owner's rules.")
	}
	linked, err := s.db.ExecContext(ctx, `UPDATE title_request_formats SET legacy_acquisition_request_id=? WHERE title_request_id=? AND format=? AND state='searching'`, legacy.ID, value.requestID, value.format)
	if err != nil {
		return fmt.Errorf("link title request download: %w", err)
	}
	if changed, _ := linked.RowsAffected(); changed != 1 {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM acquisition_requests WHERE id=?`, legacy.ID)
		return nil
	}
	selected, selectErr := s.acquisitions.Select(ctx, actor, value.libraryID, legacy.ID, results[0].ID)
	if selectErr != nil {
		current, currentErr := s.acquisitions.request(ctx, legacy.ID)
		if currentErr != nil || (current.FulfillmentState != "submitting" && current.FulfillmentState != "downloading") {
			return s.deferClaim(ctx, value, "submission_failed", selectErr.Error())
		}
		selected = current
	}
	nextState, eventType := selected.FulfillmentState, "download_submitted"
	if nextState == "downloading" {
		eventType = "download_started"
	}
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("finish title request submission: %w", err)
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE title_request_formats SET state=?,error='',next_search_at=NULL,updated_at=? WHERE title_request_id=? AND format=? AND state='searching'`, nextState, stamp, value.requestID, value.format)
	if err != nil {
		return fmt.Errorf("finish title request submission: %w", err)
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return nil
	}
	if err := appendTitleRequestEvent(ctx, tx, value.requestID, value.format, eventType, nextState, "", results[0].Title, stamp); err != nil {
		return err
	}
	if nextState == "downloading" {
		if err := s.notifyRequesterTx(ctx, tx, value.requestID, value.format, "downloading", value.title, value.requestedBy, stamp); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE title_requests SET updated_at=? WHERE id=?`, stamp, value.requestID); err != nil {
		return fmt.Errorf("update title request: %w", err)
	}
	return tx.Commit()
}

type guidedPolicy struct {
	maxBytes          int64
	allowedExtensions map[string]bool
	preferredLanguage string
	allowAbridged     bool
}

func (s *TitleRequestStore) guidedPolicy(ctx context.Context, libraryID, format string) (guidedPolicy, error) {
	var maxEbook, maxAudio int64
	var ebooks, audiobooks, language string
	var abridged bool
	err := s.db.QueryRowContext(ctx, `SELECT max_ebook_bytes,max_audiobook_bytes,allowed_ebook_extensions,allowed_audiobook_extensions,preferred_language,allow_abridged FROM acquisition_policies WHERE library_id=?`, libraryID).Scan(&maxEbook, &maxAudio, &ebooks, &audiobooks, &language, &abridged)
	if errors.Is(err, sql.ErrNoRows) {
		return guidedPolicy{}, errors.New("acquisition policy is not configured")
	}
	if err != nil {
		return guidedPolicy{}, fmt.Errorf("get guided acquisition policy: %w", err)
	}
	maxBytes, extensions := maxEbook, ebooks
	if format == "audiobook" {
		maxBytes, extensions = maxAudio, audiobooks
	}
	allowed := make(map[string]bool)
	for extension := range strings.SplitSeq(extensions, ",") {
		allowed[strings.ToLower(strings.TrimSpace(extension))] = true
	}
	return guidedPolicy{maxBytes: maxBytes, allowedExtensions: allowed, preferredLanguage: strings.ToLower(language), allowAbridged: abridged}, nil
}

func matchingGuidedResults(results []SearchResult, requestedTitle, format string, policy guidedPolicy) []SearchResult {
	requestedVolume := titleVolume(requestedTitle)
	matched := make([]SearchResult, 0, len(results))
	for _, result := range results {
		wrongFormat := result.Kind != format
		wrongSize := result.Size <= 0 || result.Size > policy.maxBytes
		disallowedExtension := !policy.allowedExtensions[strings.ToLower(result.Format)]
		disallowedAbridged := !policy.allowAbridged && result.Abridged
		wrongLanguage := result.Language != "" &&
			policy.preferredLanguage != "" &&
			strings.ToLower(result.Language) != policy.preferredLanguage
		wrongVolume := requestedVolume != "" && titleVolume(result.Title) != requestedVolume

		if wrongFormat || wrongSize || disallowedExtension || disallowedAbridged || wrongLanguage || wrongVolume {
			continue
		}
		matched = append(matched, result)
	}
	sort.SliceStable(matched, func(i, j int) bool {
		if matched[i].Relevance != matched[j].Relevance {
			return matched[i].Relevance > matched[j].Relevance
		}
		if matched[i].Title != matched[j].Title {
			return matched[i].Title < matched[j].Title
		}
		if matched[i].Size != matched[j].Size {
			return matched[i].Size < matched[j].Size
		}
		if matched[i].Source != matched[j].Source {
			return matched[i].Source < matched[j].Source
		}
		return matched[i].ID < matched[j].ID
	})
	return matched
}

func titleVolume(title string) string {
	words := releaseWords(title)
	for index, word := range words[:max(0, len(words)-1)] {
		switch strings.ToLower(word) {
		case "volume", "vol", "book", "part":
			return strings.ToLower(words[index+1])
		}
	}
	return ""
}

func (s *TitleRequestStore) deferClaim(ctx context.Context, value claimedTitleFormat, eventType, diagnosis string) error {
	diagnosis = strings.TrimSpace(diagnosis)
	if len(diagnosis) > 500 {
		diagnosis = diagnosis[:500]
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("defer title request: %w", err)
	}
	defer tx.Rollback()
	var retries int
	if err := tx.QueryRowContext(ctx, `SELECT retry_count FROM title_request_formats WHERE title_request_id=? AND format=? AND state='searching'`, value.requestID, value.format).Scan(&retries); errors.Is(err, sql.ErrNoRows) {
		return nil
	} else if err != nil {
		return fmt.Errorf("read title request retry: %w", err)
	}
	retries++
	delay := 5 * time.Minute * time.Duration(1<<min(retries-1, 7))
	if delay > 12*time.Hour {
		delay = 12 * time.Hour
	}
	now := time.Now().UTC()
	stamp, next := now.Format(time.RFC3339Nano), now.Add(delay).Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx, `UPDATE title_request_formats SET state='awaiting_release',retry_count=?,next_search_at=?,error=?,updated_at=? WHERE title_request_id=? AND format=? AND state='searching'`, retries, next, diagnosis, stamp, value.requestID, value.format); err != nil {
		return fmt.Errorf("defer title request: %w", err)
	}
	if err := appendTitleRequestEvent(ctx, tx, value.requestID, value.format, eventType, "awaiting_release", "", diagnosis, stamp); err != nil {
		return err
	}
	if retries == 1 {
		transition := "awaiting_release"
		if eventType != "no_match" {
			transition = "failed"
		}
		if err := s.notifyRequesterTx(ctx, tx, value.requestID, value.format, transition, value.title, value.requestedBy, stamp); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE title_requests SET updated_at=? WHERE id=?`, stamp, value.requestID); err != nil {
		return fmt.Errorf("update title request: %w", err)
	}
	return tx.Commit()
}

func (s *TitleRequestStore) Create(ctx context.Context, actor auth.User, input CreateTitleRequest) (TitleRequest, error) {
	input.Title = strings.TrimSpace(input.Title)
	input.Author = strings.TrimSpace(input.Author)
	input.WorkID = strings.TrimSpace(input.WorkID)
	input.ExternalSource = strings.TrimSpace(input.ExternalSource)
	input.ExternalID = strings.TrimSpace(input.ExternalID)
	if input.LibraryID == "" || input.Title == "" || len(input.Title) > 500 || len(input.Author) > 500 || len(input.CoverURL) > 2000 || (input.ExternalSource == "") != (input.ExternalID == "") {
		return TitleRequest{}, ErrInvalid
	}
	formats, err := normalizeRequestFormats(input.Formats)
	if err != nil {
		return TitleRequest{}, err
	}
	id, err := randomID()
	if err != nil {
		return TitleRequest{}, err
	}
	now := time.Now().UTC()
	stamp := now.Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return TitleRequest{}, fmt.Errorf("begin title request: %w", err)
	}
	defer tx.Rollback()

	var role string
	var canRequest, bypass bool
	args := []any{actor.ID, input.LibraryID}
	args = append(args, auth.LibraryAccessArgs(actor)...)
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(m.role,''),COALESCE(m.can_request_acquisitions,0),COALESCE(m.can_bypass_acquisition_approval,0) FROM libraries l LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE l.id=? AND `+auth.EffectiveLibraryAccessSQL("l.id"), args...).Scan(&role, &canRequest, &bypass)
	if errors.Is(err, sql.ErrNoRows) {
		return TitleRequest{}, ErrNotFound
	}
	if err != nil {
		return TitleRequest{}, fmt.Errorf("authorize title request: %w", err)
	}
	privileged := actor.Admin || role == "owner" || role == "editor"
	if !privileged && !canRequest {
		return TitleRequest{}, ErrForbidden
	}
	bypass = bypass || privileged

	maxActive := 5
	var ebookSource, audiobookSource string
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(default_ebook_source_id,''),COALESCE(default_audiobook_source_id,''),max_active_requests FROM acquisition_policies WHERE library_id=?`, input.LibraryID).Scan(&ebookSource, &audiobookSource, &maxActive)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return TitleRequest{}, fmt.Errorf("get title request policy: %w", err)
	}
	var active int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(DISTINCT r.id) FROM title_requests r JOIN title_request_formats f ON f.title_request_id=r.id WHERE r.library_id=? AND r.requested_by=? AND f.state NOT IN ('available','denied','canceled','failed')`, input.LibraryID, actor.ID).Scan(&active); err != nil {
		return TitleRequest{}, fmt.Errorf("count active title requests: %w", err)
	}
	if active >= maxActive {
		return TitleRequest{}, ErrInvalid
	}
	sources := map[string]string{"ebook": ebookSource, "audiobook": audiobookSource}
	for _, format := range formats {
		if sources[format] == "" {
			return TitleRequest{}, ErrInvalid
		}
		var valid bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM library_sources WHERE id=? AND library_id=? AND enabled=1 AND deleted_at IS NULL)`, sources[format], input.LibraryID).Scan(&valid); err != nil {
			return TitleRequest{}, fmt.Errorf("validate title request source: %w", err)
		}
		if !valid {
			return TitleRequest{}, ErrInvalid
		}
	}
	if input.WorkID != "" {
		var valid bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM works WHERE id=? AND library_id=?)`, input.WorkID, input.LibraryID).Scan(&valid); err != nil || !valid {
			return TitleRequest{}, ErrInvalid
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO title_requests(id,library_id,requested_by,work_id,external_source,external_id,title,author,cover_url,created_at,updated_at) VALUES(?,?,?,NULLIF(?,''),?,?,?,?,?,?,?)`, id, input.LibraryID, actor.ID, input.WorkID, input.ExternalSource, input.ExternalID, input.Title, input.Author, strings.TrimSpace(input.CoverURL), stamp, stamp); err != nil {
		return TitleRequest{}, fmt.Errorf("create title request: %w", err)
	}
	state := "pending_approval"
	if bypass {
		state = "wanted"
	}
	for _, format := range formats {
		if _, err := tx.ExecContext(ctx, `INSERT INTO title_request_formats(title_request_id,format,state,source_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`, id, format, state, sources[format], stamp, stamp); err != nil {
			return TitleRequest{}, fmt.Errorf("create title request format: %w", err)
		}
		if err := appendTitleRequestEvent(ctx, tx, id, format, "requested", state, actor.ID, "", stamp); err != nil {
			return TitleRequest{}, err
		}
		if state == "pending_approval" {
			if err := s.notifyRequesterTx(ctx, tx, id, format, "pending_approval", input.Title, actor.ID, stamp); err != nil {
				return TitleRequest{}, err
			}
			if err := s.notifyReviewersTx(ctx, tx, id, input.LibraryID, format, input.Title, actor.ID, actor.ID, stamp); err != nil {
				return TitleRequest{}, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return TitleRequest{}, fmt.Errorf("commit title request: %w", err)
	}
	return s.Get(ctx, actor, input.LibraryID, id)
}

func (s *TitleRequestStore) List(ctx context.Context, actor auth.User, libraryID string) ([]TitleRequest, error) {
	rows, err := s.db.QueryContext(ctx, titleRequestSelect+` WHERE r.library_id=? AND (r.requested_by=? OR ? OR m.role IN ('owner','editor')) ORDER BY r.updated_at DESC,r.id LIMIT 100`, actor.ID, libraryID, actor.ID, actor.Admin)
	if err != nil {
		return nil, fmt.Errorf("list title requests: %w", err)
	}
	defer rows.Close()
	values := make([]TitleRequest, 0)
	for rows.Next() {
		value, err := scanTitleRequest(rows)
		if err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read title requests: %w", err)
	}
	byID := make(map[string]int, len(values))
	for i := range values {
		byID[values[i].ID] = i
	}
	formatRows, err := s.db.QueryContext(ctx, `SELECT f.title_request_id,f.format,f.state,COALESCE(f.source_id,''),f.error,COALESCE(a.qbit_state,''),f.retry_count,COALESCE(f.last_searched_at,''),COALESCE(f.next_search_at,''),f.created_at,f.updated_at FROM title_request_formats f JOIN title_requests r ON r.id=f.title_request_id LEFT JOIN acquisition_requests a ON a.id=f.legacy_acquisition_request_id LEFT JOIN library_members m ON m.library_id=r.library_id AND m.user_id=? WHERE r.library_id=? AND (r.requested_by=? OR ? OR m.role IN ('owner','editor')) ORDER BY r.updated_at DESC,r.id,f.format LIMIT 200`, actor.ID, libraryID, actor.ID, actor.Admin)
	if err != nil {
		return nil, fmt.Errorf("list title request formats: %w", err)
	}
	defer formatRows.Close()
	for formatRows.Next() {
		var id, searched, next, created, updated string
		var value TitleRequestFormat
		if err := formatRows.Scan(&id, &value.Format, &value.State, &value.SourceID, &value.Error, &value.DownloadState, &value.RetryCount, &searched, &next, &created, &updated); err != nil {
			return nil, err
		}
		value.LastSearchedAt, _ = time.Parse(time.RFC3339Nano, searched)
		value.NextSearchAt, _ = time.Parse(time.RFC3339Nano, next)
		value.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		if i, ok := byID[id]; ok {
			values[i].Formats = append(values[i].Formats, value)
		}
	}
	if err := formatRows.Err(); err != nil {
		return nil, fmt.Errorf("read title request formats: %w", err)
	}
	return values, nil
}

func (s *TitleRequestStore) Get(ctx context.Context, actor auth.User, libraryID, id string) (TitleRequest, error) {
	row := s.db.QueryRowContext(ctx, titleRequestSelect+` WHERE r.id=? AND r.library_id=? AND (r.requested_by=? OR ? OR m.role IN ('owner','editor'))`, actor.ID, id, libraryID, actor.ID, actor.Admin)
	value, err := scanTitleRequest(row)
	if errors.Is(err, sql.ErrNoRows) {
		return TitleRequest{}, ErrNotFound
	}
	if err != nil {
		return TitleRequest{}, err
	}
	value.Formats, err = s.formats(ctx, value.ID)
	return value, err
}

func (s *TitleRequestStore) Approve(ctx context.Context, actor auth.User, libraryID, id, format string) error {
	return s.transition(ctx, actor, libraryID, id, format, "approved", "wanted", true)
}

func (s *TitleRequestStore) Deny(ctx context.Context, actor auth.User, libraryID, id, format string) error {
	return s.transition(ctx, actor, libraryID, id, format, "denied", "denied", true)
}

func (s *TitleRequestStore) Cancel(ctx context.Context, actor auth.User, libraryID, id, format string) error {
	if format != "ebook" && format != "audiobook" {
		return ErrInvalid
	}
	if s.acquisitions != nil {
		var state, legacyID, legacyState string
		err := s.db.QueryRowContext(ctx, `SELECT f.state,COALESCE(f.legacy_acquisition_request_id,''),COALESCE(a.fulfillment_state,'') FROM title_requests r JOIN title_request_formats f ON f.title_request_id=r.id AND f.format=? LEFT JOIN acquisition_requests a ON a.id=f.legacy_acquisition_request_id LEFT JOIN library_members m ON m.library_id=r.library_id AND m.user_id=? WHERE r.id=? AND r.library_id=? AND (? OR m.role IN ('owner','editor') OR r.requested_by=?)`, format, actor.ID, id, libraryID, actor.Admin, actor.ID).Scan(&state, &legacyID, &legacyState)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("find title request download: %w", err)
		}
		if state == "available" || state == "denied" || state == "canceled" || state == "failed" {
			return ErrInvalid
		}
		if legacyID != "" && (legacyState == "submitting" || legacyState == "downloading") {
			if err := s.acquisitions.Cancel(ctx, actor, libraryID, legacyID); err != nil {
				return fmt.Errorf("cancel title request download: %w", err)
			}
		}
	}
	return s.transition(ctx, actor, libraryID, id, format, "canceled", "canceled", false)
}

func (s *TitleRequestStore) transition(ctx context.Context, actor auth.User, libraryID, id, format, eventType, nextState string, approval bool) error {
	if format != "ebook" && format != "audiobook" {
		return ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin title request transition: %w", err)
	}
	defer tx.Rollback()
	var requestedBy, title, role, state string
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(r.requested_by,''),r.title,COALESCE(m.role,''),f.state FROM title_requests r JOIN title_request_formats f ON f.title_request_id=r.id AND f.format=? LEFT JOIN library_members m ON m.library_id=r.library_id AND m.user_id=? WHERE r.id=? AND r.library_id=?`, format, actor.ID, id, libraryID).Scan(&requestedBy, &title, &role, &state)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("authorize title request transition: %w", err)
	}
	privileged := actor.Admin || role == "owner" || role == "editor"
	if approval && !privileged {
		return ErrForbidden
	}
	if !approval && !privileged && requestedBy != actor.ID {
		return ErrForbidden
	}
	if approval && state != "pending_approval" {
		return ErrInvalid
	}
	if !approval && (state == "available" || state == "denied" || state == "canceled" || state == "failed") {
		return ErrInvalid
	}
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx, `UPDATE title_request_formats SET state=?,error='',updated_at=? WHERE title_request_id=? AND format=? AND state=?`, nextState, stamp, id, format, state); err != nil {
		return fmt.Errorf("transition title request: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE title_requests SET updated_at=? WHERE id=?`, stamp, id); err != nil {
		return fmt.Errorf("update title request: %w", err)
	}
	if err := appendTitleRequestEvent(ctx, tx, id, format, eventType, nextState, actor.ID, "", stamp); err != nil {
		return err
	}
	if err := s.notifyRequesterTx(ctx, tx, id, format, eventType, title, requestedBy, stamp); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit title request transition: %w", err)
	}
	return nil
}

const titleRequestSelect = `SELECT r.id,r.library_id,COALESCE(r.requested_by,''),COALESCE(r.work_id,''),r.external_source,r.external_id,r.title,r.author,r.cover_url,r.created_at,r.updated_at FROM title_requests r LEFT JOIN library_members m ON m.library_id=r.library_id AND m.user_id=?`

func scanTitleRequest(row rowScanner) (TitleRequest, error) {
	var value TitleRequest
	var created, updated string
	err := row.Scan(&value.ID, &value.LibraryID, &value.RequestedBy, &value.WorkID, &value.ExternalSource, &value.ExternalID, &value.Title, &value.Author, &value.CoverURL, &created, &updated)
	value.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return value, err
}

func (s *TitleRequestStore) formats(ctx context.Context, id string) ([]TitleRequestFormat, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT f.format,f.state,COALESCE(f.source_id,''),f.error,COALESCE(a.qbit_state,''),f.retry_count,COALESCE(f.last_searched_at,''),COALESCE(f.next_search_at,''),f.created_at,f.updated_at FROM title_request_formats f LEFT JOIN acquisition_requests a ON a.id=f.legacy_acquisition_request_id WHERE f.title_request_id=? ORDER BY f.format`, id)
	if err != nil {
		return nil, fmt.Errorf("list title request formats: %w", err)
	}
	defer rows.Close()
	values := make([]TitleRequestFormat, 0, 2)
	for rows.Next() {
		var value TitleRequestFormat
		var searched, next, created, updated string
		if err := rows.Scan(&value.Format, &value.State, &value.SourceID, &value.Error, &value.DownloadState, &value.RetryCount, &searched, &next, &created, &updated); err != nil {
			return nil, err
		}
		value.LastSearchedAt, _ = time.Parse(time.RFC3339Nano, searched)
		value.NextSearchAt, _ = time.Parse(time.RFC3339Nano, next)
		value.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		values = append(values, value)
	}
	return values, rows.Err()
}

func normalizeRequestFormats(values []string) ([]string, error) {
	if len(values) == 0 || len(values) > 2 {
		return nil, ErrInvalid
	}
	seen := make(map[string]bool, 2)
	formats := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if (value != "ebook" && value != "audiobook") || seen[value] {
			return nil, ErrInvalid
		}
		seen[value] = true
		formats = append(formats, value)
	}
	return formats, nil
}

func appendTitleRequestEvent(ctx context.Context, tx *sql.Tx, id, format, eventType, state, actorID, message, stamp string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO title_request_events(title_request_id,format,event_type,state,actor_id,message,created_at) VALUES(?,?,?,?,NULLIF(?,''),?,?)`, id, format, eventType, state, actorID, message, stamp)
	if err != nil {
		return fmt.Errorf("append title request event: %w", err)
	}
	return nil
}

func (s *TitleRequestStore) notifyRequesterTx(ctx context.Context, tx *sql.Tx, requestID, format, transition, title, requestedBy, stamp string) error {
	if s.notifications == nil || requestedBy == "" {
		return nil
	}
	kind, heading := "acquisition."+transition, "Request updated"
	switch transition {
	case "pending_approval":
		heading = "Request sent for approval"
	case "approved":
		heading = "Request approved"
	case "denied":
		heading = "Request declined"
	case "awaiting_release":
		heading = "Watching for a release"
	case "downloading":
		heading = "Download started"
	case "canceled":
		heading = "Request canceled"
	case "failed":
		heading = "Request needs attention"
	case "available":
		if format == "audiobook" {
			heading = "Ready to listen"
		} else {
			heading = "Ready to read"
		}
	}
	created, _ := time.Parse(time.RFC3339Nano, stamp)
	actionURL := "/activity"
	var workID string
	if transition == "available" {
		_ = tx.QueryRowContext(ctx, `SELECT COALESCE(NULLIF(r.work_id,''),(SELECT COALESCE(a.work_id,'') FROM title_request_formats f JOIN acquisition_requests a ON a.id=f.legacy_acquisition_request_id WHERE f.title_request_id=r.id AND f.format=?)) FROM title_requests r WHERE r.id=?`, format, requestID).Scan(&workID)
		if workID != "" {
			mode := "read"
			if format == "audiobook" {
				mode = "listen"
			}
			actionURL = "/consume/" + workID + "?mode=" + mode
		}
	}
	event := notification.Event{ID: "title-request:" + requestID + ":" + format + ":" + transition, Kind: kind, Title: heading, Body: title + " · " + formatLabel(format), ActionURL: actionURL, WorkID: workID, CreatedAt: created}
	return s.notifications.PublishTx(ctx, tx, event, []string{requestedBy})
}

func (s *TitleRequestStore) notifyReviewersTx(ctx context.Context, tx *sql.Tx, requestID, libraryID, format, title, requestedBy, actorID, stamp string) error {
	if s.notifications == nil {
		return nil
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM users WHERE disabled=0 AND (is_admin=1 OR id IN (SELECT user_id FROM library_members WHERE library_id=? AND role IN ('owner','editor'))) ORDER BY id`, libraryID)
	if err != nil {
		return fmt.Errorf("list acquisition reviewers: %w", err)
	}
	var recipients []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		if id != actorID || id == requestedBy {
			recipients = append(recipients, id)
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(recipients) == 0 {
		return nil
	}
	created, _ := time.Parse(time.RFC3339Nano, stamp)
	event := notification.Event{ID: "title-request:" + requestID + ":" + format + ":approval-needed", Kind: "acquisition.approval_needed", Title: "Book request needs approval", Body: title + " · " + formatLabel(format), ActionURL: "/acquisitions", CreatedAt: created}
	return s.notifications.PublishTx(ctx, tx, event, recipients)
}

func formatLabel(format string) string {
	if format == "audiobook" {
		return "Audiobook"
	}
	return "Ebook"
}
