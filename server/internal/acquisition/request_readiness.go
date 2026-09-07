package acquisition

import (
	"context"
	"fmt"

	"github.com/mahcks/aldus/server/internal/auth"
)

type RequestLibrary struct {
	LibraryID       string
	LibraryName     string
	EbookReason     string
	AudiobookReason string
}

func (s *Store) RequestLibraries(ctx context.Context, actor auth.User) ([]RequestLibrary, error) {
	enabled, err := s.Available(ctx)
	if err != nil {
		return nil, err
	}
	args := []any{actor.ID, actor.ID}
	args = append(args, auth.LibraryAccessArgs(actor)...)
	rows, err := s.db.QueryContext(ctx, `SELECT l.id,l.name,COALESCE(m.role,''),COALESCE(m.can_request_acquisitions,0),
		EXISTS(SELECT 1 FROM library_sources ls WHERE ls.id=p.default_ebook_source_id AND ls.library_id=l.id AND ls.enabled=1 AND ls.deleted_at IS NULL),
		EXISTS(SELECT 1 FROM library_sources ls WHERE ls.id=p.default_audiobook_source_id AND ls.library_id=l.id AND ls.enabled=1 AND ls.deleted_at IS NULL),
		(SELECT COUNT(*) FROM title_requests r WHERE r.library_id=l.id AND r.requested_by=? AND `+activeTitleSQL+`),
		COALESCE(p.max_active_requests,5)
		FROM libraries l LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=?
		LEFT JOIN acquisition_policies p ON p.library_id=l.id
		WHERE `+auth.EffectiveLibraryAccessSQL("l.id")+` ORDER BY l.name,l.id`, args...)
	if err != nil {
		return nil, fmt.Errorf("get request readiness: %w", err)
	}
	defer rows.Close()
	values := make([]RequestLibrary, 0)
	for rows.Next() {
		var value RequestLibrary
		var role string
		var allowed, ebook, audio bool
		var active, limit int
		if err := rows.Scan(&value.LibraryID, &value.LibraryName, &role, &allowed, &ebook, &audio, &active, &limit); err != nil {
			return nil, err
		}
		allowed = allowed || actor.Admin || role == "owner" || role == "editor"
		reason := func(configured bool) string {
			switch {
			case !allowed:
				return "permission"
			case !enabled:
				return "disabled"
			case !configured:
				return "setup"
			case active >= limit:
				return "quota"
			default:
				return ""
			}
		}
		value.EbookReason = reason(ebook)
		value.AudiobookReason = reason(audio)
		values = append(values, value)
	}
	return values, rows.Err()
}
