package catalog

import (
	"context"
	"fmt"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

type OPDSPublication struct {
	WorkID      string
	MediaID     string
	LibraryName string
	Title       string
	Author      string
	Filename    string
	UpdatedAt   time.Time
}

func (s *Store) OPDSPublications(ctx context.Context, actor auth.User) ([]OPDSPublication, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT w.id,m.id,l.name,w.title,COALESCE(w.author,''),COALESCE(m.original_filename,''),w.updated_at
		FROM media m
		JOIN representations r ON r.id=m.representation_id
		JOIN works w ON w.id=r.work_id
		JOIN libraries l ON l.id=w.library_id
		WHERE m.kind='epub' AND `+auth.EffectiveLibraryAccessSQL("w.library_id")+`
		AND NOT EXISTS (SELECT 1 FROM media newer WHERE newer.representation_id=m.representation_id AND (newer.created_at>m.created_at OR (newer.created_at=m.created_at AND newer.id>m.id)))
		ORDER BY w.title COLLATE NOCASE,w.author COLLATE NOCASE,m.id`, auth.LibraryAccessArgs(actor)...)
	if err != nil {
		return nil, fmt.Errorf("list OPDS publications: %w", err)
	}
	defer rows.Close()
	var values []OPDSPublication
	for rows.Next() {
		var value OPDSPublication
		var updated string
		if err := rows.Scan(&value.WorkID, &value.MediaID, &value.LibraryName, &value.Title, &value.Author, &value.Filename, &updated); err != nil {
			return nil, err
		}
		value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		values = append(values, value)
	}
	return values, rows.Err()
}
