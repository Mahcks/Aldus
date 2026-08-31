package position

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

func (s *Store) KOReaderDocument(ctx context.Context, username, documentID string) (KOReaderDocument, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id,w.id,r.id,m.id,COALESCE((
			SELECT a.id FROM alignments a
			WHERE a.epub_media_id=m.id AND a.state='ready'
			ORDER BY a.revision DESC,a.id LIMIT 1
		),'')
		FROM users u
		CROSS JOIN koreader_aliases k
		JOIN media m ON m.id=k.media_id AND m.kind='epub'
		JOIN representations r ON r.id=m.representation_id
		JOIN works w ON w.id=r.work_id
		WHERE u.username_normalized=lower(trim(?)) AND u.disabled=0 AND k.document_id=?
		AND (
			EXISTS(SELECT 1 FROM library_members exclusive_grant WHERE exclusive_grant.user_id=u.id AND exclusive_grant.library_id=w.library_id AND exclusive_grant.exclusive=1)
			OR (
				NOT EXISTS(SELECT 1 FROM library_members exclusive_override WHERE exclusive_override.user_id=u.id AND exclusive_override.exclusive=1)
				AND (u.is_admin=1 OR EXISTS(SELECT 1 FROM library_members additive_grant WHERE additive_grant.user_id=u.id AND additive_grant.library_id=w.library_id))
			)
		)
		ORDER BY m.created_at DESC,m.id DESC`, username, documentID)
	if err != nil {
		return KOReaderDocument{}, fmt.Errorf("find KOReader document: %w", err)
	}
	defer rows.Close()
	var found KOReaderDocument
	for rows.Next() {
		var value KOReaderDocument
		if err := rows.Scan(&value.UserID, &value.WorkID, &value.RepresentationID, &value.MediaID, &value.AlignmentID); err != nil {
			return KOReaderDocument{}, fmt.Errorf("scan KOReader document: %w", err)
		}
		if found.MediaID == "" {
			found = value
			continue
		}
		if value.RepresentationID != found.RepresentationID {
			return KOReaderDocument{}, ErrAmbiguous
		}
	}
	if err := rows.Err(); err != nil {
		return KOReaderDocument{}, fmt.Errorf("read KOReader documents: %w", err)
	}
	if found.MediaID == "" {
		return KOReaderDocument{}, ErrNotFound
	}
	return found, nil
}

func (s *Store) KOReaderProgress(ctx context.Context, userID, mediaID string) (KOReaderProgress, error) {
	var value KOReaderProgress
	var updated string
	err := s.db.QueryRowContext(ctx, `SELECT progress,percentage,device,device_id,updated_at FROM koreader_progress WHERE user_id=? AND media_id=?`, userID, mediaID).Scan(&value.Progress, &value.Percentage, &value.Device, &value.DeviceID, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return KOReaderProgress{}, ErrNotFound
	}
	if err != nil {
		return KOReaderProgress{}, fmt.Errorf("get KOReader progress: %w", err)
	}
	value.UpdatedAt, err = time.Parse(time.RFC3339Nano, updated)
	if err != nil {
		return KOReaderProgress{}, fmt.Errorf("parse KOReader progress time: %w", err)
	}
	return value, nil
}

func (s *Store) SaveKOReaderProgress(ctx context.Context, userID, mediaID string, value KOReaderProgress) (KOReaderProgress, error) {
	value.Progress = strings.TrimSpace(value.Progress)
	value.Device = strings.TrimSpace(value.Device)
	value.DeviceID = strings.TrimSpace(value.DeviceID)
	if value.Progress == "" || value.Device == "" || value.DeviceID == "" || math.IsNaN(value.Percentage) || math.IsInf(value.Percentage, 0) || value.Percentage < 0 || value.Percentage > 1 {
		return KOReaderProgress{}, ErrInvalid
	}
	value.UpdatedAt = time.Now().UTC()
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO koreader_progress(user_id,media_id,progress,percentage,device,device_id,updated_at)
		SELECT ?,?,?,?,?,?,? FROM media WHERE id=? AND kind='epub'
		ON CONFLICT(user_id,media_id) DO UPDATE SET progress=excluded.progress,percentage=excluded.percentage,device=excluded.device,device_id=excluded.device_id,updated_at=excluded.updated_at`,
		userID, mediaID, value.Progress, value.Percentage, value.Device, value.DeviceID, value.UpdatedAt.Format(time.RFC3339Nano), mediaID)
	if err != nil {
		return KOReaderProgress{}, fmt.Errorf("save KOReader progress: %w", err)
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return KOReaderProgress{}, ErrNotFound
	}
	return value, nil
}
