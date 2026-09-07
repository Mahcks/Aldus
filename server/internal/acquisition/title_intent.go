package acquisition

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

var (
	ErrQuota       = fmt.Errorf("%w: active request limit reached", ErrInvalid)
	ErrSplitIntent = fmt.Errorf("%w: formats already have separate active requests", ErrInvalid)
	ErrSetup       = fmt.Errorf("%w: format request setup incomplete", ErrInvalid)
)

// Match only this reader's active titles. Known identities never fall back to names.
func activeTitleIntent(ctx context.Context, tx *sql.Tx, userID string, input CreateTitleRequest) (string, map[string]bool, error) {
	predicate := "r.work_id IS NULL AND r.external_id=''"
	args := []any{input.LibraryID, userID}
	if input.WorkID != "" {
		predicate = "r.work_id=?"
		args = append(args, input.WorkID)
	} else if input.ExternalID != "" {
		predicate = "r.external_source=? AND r.external_id=?"
		args = append(args, input.ExternalSource, input.ExternalID)
	}
	rows, err := tx.QueryContext(ctx, `SELECT r.id,r.title,r.author,f.format FROM title_requests r
		JOIN title_request_formats f ON f.title_request_id=r.id AND f.state NOT IN ('denied','canceled','failed')
		WHERE r.library_id=? AND r.requested_by=? AND `+predicate+`
		AND `+activeTitleSQL+` ORDER BY r.created_at,r.id,f.format`, args...)
	if err != nil {
		return "", nil, fmt.Errorf("find active title intent: %w", err)
	}
	defer rows.Close()
	ids := make([]string, 0)
	byID := make(map[string]map[string]bool)
	for rows.Next() {
		var id, title, author, format string
		if err := rows.Scan(&id, &title, &author, &format); err != nil {
			return "", nil, err
		}
		if input.WorkID == "" && input.ExternalID == "" &&
			(normalizedTitleIdentity(title) != normalizedTitleIdentity(input.Title) ||
				normalizedTitleIdentity(author) != normalizedTitleIdentity(input.Author)) {
			continue
		}
		if byID[id] == nil {
			ids = append(ids, id)
			byID[id] = make(map[string]bool)
		}
		byID[id][format] = true
	}
	if err := rows.Err(); err != nil {
		return "", nil, err
	}
	// Older clients created ebook and audio requests separately. Prefer the record
	// that already owns this format, never add a duplicate to its sibling.
	bestID, bestCount := "", -1
	covered := make(map[string]bool)
	for _, id := range ids {
		count := 0
		for _, raw := range input.Formats {
			format := strings.ToLower(strings.TrimSpace(raw))
			if byID[id][format] {
				covered[format] = true
				count++
			}
		}
		if count > bestCount {
			bestID, bestCount = id, count
		}
	}
	if bestID != "" && bestCount < len(covered) {
		// Two existing request IDs cannot be represented by one response/action target.
		return "", nil, ErrSplitIntent
	}
	return bestID, byID[bestID], nil
}

func normalizedTitleIdentity(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(value), " "))
}
