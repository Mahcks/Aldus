package ownership

import (
	"context"
	"errors"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

var ErrWatchLimit = errors.New("too many reading watches")

type watchKey struct{ userID, workID string }

func (s *Store) subscribe(userID, workID string) (<-chan struct{}, func(), error) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()

	total := 0
	userCount := 0
	for key, watchers := range s.watchers {
		total += len(watchers)
		if key.userID == userID {
			userCount += len(watchers)
		}
	}
	if total >= 1024 || userCount >= 64 {
		return nil, nil, ErrWatchLimit
	}

	key := watchKey{userID, workID}
	if s.watchers == nil {
		s.watchers = make(map[watchKey]map[chan struct{}]struct{})
	}
	if s.watchers[key] == nil {
		s.watchers[key] = make(map[chan struct{}]struct{})
	}

	changed := make(chan struct{}, 1)
	s.watchers[key][changed] = struct{}{}

	return changed, func() {
		s.watchMu.Lock()
		defer s.watchMu.Unlock()
		delete(s.watchers[key], changed)
		if len(s.watchers[key]) == 0 {
			delete(s.watchers, key)
		}
	}, nil
}

func (s *Store) notify(userID, workID string) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	// ponytail: notifications are process-local; multiple writer processes would
	// need shared invalidation. Timeout reads still recover persisted ownership.
	for changed := range s.watchers[watchKey{userID, workID}] {
		select {
		case changed <- struct{}{}:
		default:
		}
	}
}

// Watch holds no database connection while waiting. Subscribe before the final
// read so a commit between registration and reading cannot be missed.
func (s *Store) Watch(ctx context.Context, actor auth.User, workID string, epoch int64, wait time.Duration) (*Session, error) {
	if epoch < 0 {
		return nil, ErrInvalid
	}
	if _, err := s.Get(ctx, actor, workID); err != nil {
		return nil, err
	}

	changed, unsubscribe, err := s.subscribe(actor.ID, workID)
	if err != nil {
		return nil, err
	}
	defer unsubscribe()

	timer := time.NewTimer(wait)
	defer timer.Stop()

	for {
		owner, err := s.Get(ctx, actor, workID)
		if err != nil {
			return nil, err
		}

		currentEpoch := int64(0)
		if owner != nil {
			currentEpoch = owner.Epoch
		}
		if currentEpoch != epoch {
			return owner, nil
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
			return s.Get(ctx, actor, workID)
		case <-changed:
		}
	}
}
