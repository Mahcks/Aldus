package acquisition

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

type TitleRequestListOptions struct {
	WorkID string
	Filter string
	Cursor string
	Limit  int
	Own    bool
}

type TitleRequestPage struct {
	Items      []TitleRequest
	NextCursor string
}

type titleRequestCursor struct {
	Created string
	ID      string
}

const activeTitleSQL = `EXISTS(SELECT 1 FROM title_request_formats state_format WHERE state_format.title_request_id=r.id AND state_format.state NOT IN ('available','denied','canceled','failed'))`
const readyTitleSQL = `EXISTS(SELECT 1 FROM title_request_formats state_format WHERE state_format.title_request_id=r.id AND state_format.state='available')`

func (s *TitleRequestStore) ListPage(ctx context.Context, actor auth.User, libraryID string, options TitleRequestListOptions) (TitleRequestPage, error) {
	result := TitleRequestPage{Items: make([]TitleRequest, 0)}
	if options.Limit == 0 {
		options.Limit = 50
	}
	if options.Limit < 1 || options.Limit > 100 {
		return result, ErrInvalid
	}
	predicate := ""
	switch options.Filter {
	case "", "all":
	case "active":
		predicate = " AND " + activeTitleSQL
	case "ready":
		predicate = " AND NOT " + activeTitleSQL + " AND " + readyTitleSQL
	case "history":
		predicate = " AND NOT " + activeTitleSQL + " AND NOT " + readyTitleSQL
	case "pending_approval":
		predicate = " AND EXISTS(SELECT 1 FROM title_request_formats f WHERE f.title_request_id=r.id AND f.state='pending_approval')"
	default:
		return result, ErrInvalid
	}
	args := append([]any{actor.ID, libraryID}, auth.LibraryAccessArgs(actor)...)
	args = append(args, actor.ID, actor.Admin)
	if options.WorkID != "" {
		predicate += " AND r.work_id=?"
		args = append(args, options.WorkID)
	}
	if options.Own {
		predicate += " AND r.requested_by=?"
		args = append(args, actor.ID)
	}
	if options.Cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(options.Cursor)
		var cursor titleRequestCursor
		if err != nil || json.Unmarshal(raw, &cursor) != nil || cursor.ID == "" || cursor.Created == "" {
			return result, ErrInvalid
		}
		predicate += " AND (r.created_at<? OR (r.created_at=? AND r.id>?))"
		args = append(args, cursor.Created, cursor.Created, cursor.ID)
	}
	args = append(args, options.Limit+1)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, titleRequestSelect+` WHERE r.library_id=? AND `+auth.EffectiveLibraryAccessSQL("r.library_id")+`
		AND (r.requested_by=? OR ? OR m.role IN ('owner','editor'))`+predicate+` ORDER BY r.created_at DESC,r.id LIMIT ?`, args...)
	if err != nil {
		return result, fmt.Errorf("list title requests: %w", err)
	}
	// Keep the stored timestamp for the cursor; reformatting RFC3339 can change lexical ordering.
	stamps := make(map[string]string)
	for rows.Next() {
		var value TitleRequest
		var created, updated string
		if err := rows.Scan(&value.ID, &value.LibraryID, &value.RequestedBy, &value.WorkID, &value.ExternalSource, &value.ExternalID, &value.Title, &value.Author, &value.CoverURL, &created, &updated); err != nil {
			rows.Close()
			return result, err
		}
		value.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		value.Formats = make([]TitleRequestFormat, 0)
		stamps[value.ID] = created
		result.Items = append(result.Items, value)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	if len(result.Items) > options.Limit {
		result.Items = result.Items[:options.Limit]
		last := result.Items[len(result.Items)-1]
		raw, err := json.Marshal(titleRequestCursor{Created: stamps[last.ID], ID: last.ID})
		if err != nil {
			return result, err
		}
		result.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	if len(result.Items) == 0 {
		return result, tx.Commit()
	}
	ids := make([]any, len(result.Items))
	byID := make(map[string]int, len(ids))
	for i, value := range result.Items {
		ids[i] = value.ID
		byID[value.ID] = i
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	rows, err = tx.QueryContext(ctx, `SELECT f.title_request_id,f.format,f.state,COALESCE(f.source_id,''),f.error,COALESCE(a.qbit_state,''),f.retry_count,COALESCE(f.last_searched_at,''),COALESCE(f.next_search_at,''),f.created_at,f.updated_at
		FROM title_request_formats f LEFT JOIN acquisition_requests a ON a.id=f.legacy_acquisition_request_id
		WHERE f.title_request_id IN (`+placeholders+`) ORDER BY f.title_request_id,f.format`, ids...)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var id, searched, next, created, updated string
		var value TitleRequestFormat
		if err := rows.Scan(&id, &value.Format, &value.State, &value.SourceID, &value.Error, &value.DownloadState, &value.RetryCount, &searched, &next, &created, &updated); err != nil {
			rows.Close()
			return result, err
		}
		value.LastSearchedAt, _ = time.Parse(time.RFC3339Nano, searched)
		value.NextSearchAt, _ = time.Parse(time.RFC3339Nano, next)
		value.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		i := byID[id]
		result.Items[i].Formats = append(result.Items[i].Formats, value)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	return result, tx.Commit()
}
