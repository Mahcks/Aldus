package acquisition

import (
	"context"
	"fmt"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

type TitleRequestEvent struct {
	Format, State, Message string
	CreatedAt              time.Time
}

func (s *TitleRequestStore) Events(ctx context.Context, actor auth.User, libraryID, requestID string) ([]TitleRequestEvent, error) {
	if _, err := s.Get(ctx, actor, libraryID, requestID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT COALESCE(format,''),COALESCE(state,''),message,created_at FROM title_request_events WHERE title_request_id=? ORDER BY id DESC LIMIT 100`, requestID)
	if err != nil {
		return nil, fmt.Errorf("list title request events: %w", err)
	}
	defer rows.Close()
	values := make([]TitleRequestEvent, 0)
	for rows.Next() {
		var value TitleRequestEvent
		var created string
		if err := rows.Scan(&value.Format, &value.State, &value.Message, &created); err != nil {
			return nil, fmt.Errorf("scan title request event: %w", err)
		}
		value.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read title request events: %w", err)
	}
	return values, nil
}
