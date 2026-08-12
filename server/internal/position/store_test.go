package position

import (
	"context"

	"github.com/mahcks/aldus/server/internal/database"
)

func openTestStore(ctx context.Context, path string) (*Store, error) {
	db, err := database.Open(ctx, path)
	if err != nil {
		return nil, err
	}
	return New(db), nil
}

func (s *Store) Close() error { return s.db.Close() }
