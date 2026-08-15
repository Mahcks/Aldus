package position

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"time"
)

type ActivitySession struct {
	ID, WorkID, Mode      string
	StartedAt, LastSeenAt time.Time
	EndedAt               *time.Time
	ActiveSeconds         int
}

func (s *Store) StartActivity(ctx context.Context, userID, workID, mode string) (ActivitySession, error) {
	if mode != "read" && mode != "listen" {
		return ActivitySession{}, ErrInvalid
	}
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return ActivitySession{}, fmt.Errorf("create activity id: %w", err)
	}
	id := base64.RawURLEncoding.EncodeToString(b)
	now := time.Now().UTC()
	stamp := now.Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `INSERT INTO reading_activity_sessions(id,user_id,work_id,mode,started_at,last_seen_at) VALUES(?,?,?,?,?,?)`, id, userID, workID, mode, stamp, stamp)
	if err != nil {
		return ActivitySession{}, fmt.Errorf("start reading activity: %w", err)
	}
	return ActivitySession{ID: id, WorkID: workID, Mode: mode, StartedAt: now, LastSeenAt: now}, nil
}

func (s *Store) UpdateActivity(ctx context.Context, userID, id string, activeSeconds int, ended bool) (ActivitySession, error) {
	if activeSeconds < 0 || activeSeconds > 86400 {
		return ActivitySession{}, ErrInvalid
	}
	now := time.Now().UTC()
	stamp := now.Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx, `UPDATE reading_activity_sessions SET active_seconds=MAX(active_seconds,?),last_seen_at=?,ended_at=CASE WHEN ? THEN ? ELSE ended_at END WHERE id=? AND user_id=? AND ended_at IS NULL`, activeSeconds, stamp, ended, stamp, id, userID)
	if err != nil {
		return ActivitySession{}, fmt.Errorf("update reading activity: %w", err)
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return ActivitySession{}, ErrNotFound
	}
	return s.activity(ctx, userID, id)
}

func (s *Store) activity(ctx context.Context, userID, id string) (ActivitySession, error) {
	var value ActivitySession
	var started, seen string
	var ended sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT id,work_id,mode,started_at,last_seen_at,ended_at,active_seconds FROM reading_activity_sessions WHERE id=? AND user_id=?`, id, userID).Scan(&value.ID, &value.WorkID, &value.Mode, &started, &seen, &ended, &value.ActiveSeconds)
	if errors.Is(err, sql.ErrNoRows) {
		return ActivitySession{}, ErrNotFound
	}
	if err != nil {
		return ActivitySession{}, err
	}
	value.StartedAt, _ = time.Parse(time.RFC3339Nano, started)
	value.LastSeenAt, _ = time.Parse(time.RFC3339Nano, seen)
	if ended.Valid {
		parsed, _ := time.Parse(time.RFC3339Nano, ended.String)
		value.EndedAt = &parsed
	}
	return value, nil
}
