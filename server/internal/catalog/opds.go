package catalog

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

type OPDSPublication struct {
	MediaID       string
	LibraryName   string
	Title         string
	Author        string
	CoverID       string
	CoverSource   string
	CoverSourceID string
	CoverURL      string
	CoverType     string
	UpdatedAt     time.Time
}

func (s *Store) OPDSPublications(ctx context.Context, actor auth.User, search string, limit, offset int) ([]OPDSPublication, bool, time.Time, error) {
	search = strings.TrimSpace(search)
	if len([]rune(search)) > 200 {
		search = string([]rune(search)[:200])
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	joins := `
		FROM media m
		JOIN representations r ON r.id=m.representation_id
		JOIN works w ON w.id=r.work_id
		JOIN libraries l ON l.id=w.library_id
		LEFT JOIN work_covers c ON c.id=w.selected_cover_id`
	where := `
		WHERE m.kind='epub' AND ` + auth.EffectiveLibraryAccessSQL("w.library_id") + `
		AND NOT EXISTS (SELECT 1 FROM media newer WHERE newer.representation_id=m.representation_id AND (newer.created_at>m.created_at OR (newer.created_at=m.created_at AND newer.id>m.id)))`
	args := auth.LibraryAccessArgs(actor)
	if search != "" {
		where += ` AND (w.title LIKE '%' || ? || '%' COLLATE NOCASE OR COALESCE(w.author,'') LIKE '%' || ? || '%' COLLATE NOCASE OR l.name LIKE '%' || ? || '%' COLLATE NOCASE)`
		args = append(args, search, search, search)
	}

	var updatedRaw string
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(w.updated_at),'1970-01-01T00:00:00Z')`+joins+where, args...).Scan(&updatedRaw); err != nil {
		return nil, false, time.Time{}, fmt.Errorf("read OPDS catalog revision: %w", err)
	}
	updated, _ := time.Parse(time.RFC3339Nano, updatedRaw)

	pageArgs := append(append([]any{}, args...), limit+1, offset)
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.id,l.name,w.title,COALESCE(w.author,''),
			COALESCE(c.id,''),COALESCE(c.source,''),COALESCE(c.source_id,''),COALESCE(c.image_url,''),COALESCE(c.image_type,''),w.updated_at`+
		joins+where+`
		ORDER BY w.updated_at DESC,w.title COLLATE NOCASE,w.author COLLATE NOCASE,m.id
		LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return nil, false, time.Time{}, fmt.Errorf("list OPDS publications: %w", err)
	}
	defer rows.Close()
	var values []OPDSPublication
	for rows.Next() {
		var value OPDSPublication
		var itemUpdated string
		if err := rows.Scan(&value.MediaID, &value.LibraryName, &value.Title, &value.Author, &value.CoverID, &value.CoverSource, &value.CoverSourceID, &value.CoverURL, &value.CoverType, &itemUpdated); err != nil {
			return nil, false, time.Time{}, err
		}
		value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, itemUpdated)
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		return nil, false, time.Time{}, err
	}
	hasMore := len(values) > limit
	if hasMore {
		values = values[:limit]
	}
	return values, hasMore, updated, nil
}
