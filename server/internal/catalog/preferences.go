package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

type WorkPreference struct {
	WorkID, EPUBMediaID, AudioMediaID, AlignmentID string
	UpdatedAt                                      time.Time
}

func (s *Store) WorkPreference(ctx context.Context, actor auth.User, workID string) (WorkPreference, error) {
	var value WorkPreference
	var updated string
	err := s.db.QueryRowContext(ctx, `SELECT p.work_id,p.epub_media_id,p.audio_media_id,p.alignment_id,p.updated_at FROM user_work_preferences p JOIN works w ON w.id=p.work_id LEFT JOIN library_members m ON m.library_id=w.library_id AND m.user_id=? JOIN alignments a ON a.id=p.alignment_id AND a.state='ready' AND a.epub_media_id=p.epub_media_id AND a.audio_media_id=p.audio_media_id WHERE p.user_id=? AND p.work_id=? AND (? OR m.user_id IS NOT NULL)`, actor.ID, actor.ID, workID, actor.Admin).Scan(&value.WorkID, &value.EPUBMediaID, &value.AudioMediaID, &value.AlignmentID, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return WorkPreference{}, ErrNotFound
	}
	if err != nil {
		return WorkPreference{}, fmt.Errorf("get Work preference: %w", err)
	}
	value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return value, nil
}

func (s *Store) SetWorkPreference(ctx context.Context, actor auth.User, value WorkPreference) (WorkPreference, error) {
	if value.WorkID == "" || value.EPUBMediaID == "" || value.AudioMediaID == "" || value.AlignmentID == "" {
		return WorkPreference{}, ErrInvalid
	}
	now := time.Now().UTC()
	result, err := s.db.ExecContext(ctx, `INSERT INTO user_work_preferences(user_id,work_id,epub_media_id,audio_media_id,alignment_id,updated_at) SELECT ?,w.id,a.epub_media_id,a.audio_media_id,a.id,? FROM works w LEFT JOIN library_members m ON m.library_id=w.library_id AND m.user_id=? JOIN alignments a ON a.id=? AND a.state='ready' JOIN media em ON em.id=a.epub_media_id JOIN representations er ON er.id=em.representation_id AND er.work_id=w.id JOIN media am ON am.id=a.audio_media_id JOIN representations ar ON ar.id=am.representation_id AND ar.work_id=w.id WHERE w.id=? AND a.epub_media_id=? AND a.audio_media_id=? AND (? OR m.user_id IS NOT NULL) ON CONFLICT(user_id,work_id) DO UPDATE SET epub_media_id=excluded.epub_media_id,audio_media_id=excluded.audio_media_id,alignment_id=excluded.alignment_id,updated_at=excluded.updated_at`, actor.ID, now.Format(time.RFC3339Nano), actor.ID, value.AlignmentID, value.WorkID, value.EPUBMediaID, value.AudioMediaID, actor.Admin)
	if err != nil {
		return WorkPreference{}, fmt.Errorf("set Work preference: %w", err)
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return WorkPreference{}, ErrNotFound
	}
	value.UpdatedAt = now
	return value, nil
}
