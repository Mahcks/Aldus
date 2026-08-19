package notification

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrInvalid  = errors.New("invalid notification")
	ErrNotFound = errors.New("notification not found")
)

type Event struct {
	ID        string
	Kind      string
	Title     string
	Body      string
	ActionURL string
	CreatedAt time.Time
	ReadAt    *time.Time
}

type Store struct {
	db *sql.DB
}

func New(db *sql.DB) *Store { return &Store{db: db} }

func (s *Store) Publish(ctx context.Context, event Event, userIDs []string) (Event, error) {
	event, err := prepareEvent(event, userIDs)
	if err != nil {
		return Event{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Event{}, fmt.Errorf("begin notification publication: %w", err)
	}
	defer tx.Rollback()
	if err := s.PublishTx(ctx, tx, event, userIDs); err != nil {
		return Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return Event{}, fmt.Errorf("commit notification publication: %w", err)
	}
	return event, nil
}

func (s *Store) PublishTx(ctx context.Context, tx *sql.Tx, event Event, userIDs []string) error {
	event, err := prepareEvent(event, userIDs)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO notification_events(id,kind,title,body,action_url,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, event.ID, event.Kind, event.Title, event.Body, event.ActionURL, event.CreatedAt.Format(time.RFC3339Nano)); err != nil {
		return fmt.Errorf("insert notification event: %w", err)
	}
	for _, userID := range userIDs {
		userID = strings.TrimSpace(userID)
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO notification_recipients(event_id,user_id) VALUES(?,?)`, event.ID, userID); err != nil {
			return fmt.Errorf("insert notification recipient: %w", err)
		}
	}
	return nil
}

func prepareEvent(event Event, userIDs []string) (Event, error) {
	event.Kind = strings.TrimSpace(event.Kind)
	event.Title = strings.TrimSpace(event.Title)
	event.ActionURL = strings.TrimSpace(event.ActionURL)
	if event.Kind == "" || event.Title == "" || len(userIDs) == 0 {
		return Event{}, ErrInvalid
	}
	if event.ID == "" {
		id, err := newID()
		if err != nil {
			return Event{}, fmt.Errorf("generate notification ID: %w", err)
		}
		event.ID = id
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now().UTC()
	} else {
		event.CreatedAt = event.CreatedAt.UTC()
	}

	for _, userID := range userIDs {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			return Event{}, ErrInvalid
		}
	}
	return event, nil
}

func (s *Store) List(ctx context.Context, userID string, limit, offset int) ([]Event, error) {
	limit, offset = page(limit, offset)
	rows, err := s.db.QueryContext(ctx, `
		SELECT e.id,e.kind,e.title,e.body,e.action_url,e.created_at,r.read_at
		FROM notification_recipients r
		JOIN notification_events e ON e.id=r.event_id
		WHERE r.user_id=?
		ORDER BY e.created_at DESC,e.id DESC
		LIMIT ? OFFSET ?`, userID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list notifications: %w", err)
	}
	defer rows.Close()
	items := make([]Event, 0)
	for rows.Next() {
		var item Event
		var createdAt string
		var readAt sql.NullString
		if err := rows.Scan(&item.ID, &item.Kind, &item.Title, &item.Body, &item.ActionURL, &createdAt, &readAt); err != nil {
			return nil, fmt.Errorf("scan notification: %w", err)
		}
		item.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
		if err != nil {
			return nil, fmt.Errorf("parse notification creation time: %w", err)
		}
		if readAt.Valid {
			value, err := time.Parse(time.RFC3339Nano, readAt.String)
			if err != nil {
				return nil, fmt.Errorf("parse notification read time: %w", err)
			}
			item.ReadAt = &value
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate notifications: %w", err)
	}
	return items, nil
}

func (s *Store) UnreadCount(ctx context.Context, userID string) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notification_recipients WHERE user_id=? AND read_at IS NULL`, userID).Scan(&count); err != nil {
		return 0, fmt.Errorf("count unread notifications: %w", err)
	}
	return count, nil
}

func (s *Store) MarkRead(ctx context.Context, userID, eventID string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE notification_recipients SET read_at=COALESCE(read_at,?) WHERE user_id=? AND event_id=?`, time.Now().UTC().Format(time.RFC3339Nano), userID, eventID)
	if err != nil {
		return fmt.Errorf("mark notification read: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect notification update: %w", err)
	}
	if changed == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) MarkAllRead(ctx context.Context, userID string) error {
	if _, err := s.db.ExecContext(ctx, `UPDATE notification_recipients SET read_at=? WHERE user_id=? AND read_at IS NULL`, time.Now().UTC().Format(time.RFC3339Nano), userID); err != nil {
		return fmt.Errorf("mark notifications read: %w", err)
	}
	return nil
}

func page(limit, offset int) (int, int) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func newID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
