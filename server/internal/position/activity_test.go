package position

import (
	"context"
	"errors"
	"testing"
)

func TestActivitySessionIsBoundedAndUserScoped(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	userID := addFixtureUser(t, store)
	otherID := addFixtureUserNamed(t, store, "other-user", "other")

	session, err := store.StartActivity(ctx, userID, "fixture-work", "read")
	if err != nil {
		t.Fatal(err)
	}
	session, err = store.UpdateActivity(ctx, userID, session.ID, 42, true)
	if err != nil || session.ActiveSeconds != 42 || session.EndedAt == nil {
		t.Fatalf("ended session = %#v, %v", session, err)
	}
	if _, err := store.UpdateActivity(ctx, userID, session.ID, 43, true); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second finish error = %v", err)
	}
	if _, err := store.UpdateActivity(ctx, otherID, session.ID, 43, false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-user update error = %v", err)
	}
	if _, err := store.StartActivity(ctx, userID, "fixture-work", "watch"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid mode error = %v", err)
	}
}
