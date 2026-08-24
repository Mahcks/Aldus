package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

func (s *Store) SetWorkStatus(ctx context.Context, actor auth.User, workID, status string) error {
	if status != "" && !oneOf(status, "want_to_read", "reading", "finished") {
		return ErrInvalid
	}
	var accessible bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM works w WHERE w.id=? AND `+auth.EffectiveLibraryAccessSQL("w.library_id")+`)`, append([]any{workID}, auth.LibraryAccessArgs(actor)...)...).Scan(&accessible); err != nil {
		return fmt.Errorf("authorize work status: %w", err)
	}
	if !accessible {
		return ErrNotFound
	}
	if status == "" {
		_, err := s.db.ExecContext(ctx, `DELETE FROM user_work_statuses WHERE user_id=? AND work_id=?`, actor.ID, workID)
		return err
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO user_work_statuses(user_id,work_id,status,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,work_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`, actor.ID, workID, status, time.Now().UTC().Format(time.RFC3339Nano))
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
