package notification

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestInboxIsPrivateAndReadStateDoesNotMutateEvent(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	accounts, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	owner, err := accounts.Setup(ctx, auth.Credentials{Username: "owner", Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	reader, _, err := accounts.CreateUser(ctx, owner.User, auth.Credentials{Username: "reader", Password: "a-secure-test-password"}, false, "")
	if err != nil {
		t.Fatal(err)
	}

	store := New(db)
	created := time.Date(2026, 8, 18, 12, 0, 0, 0, time.UTC)
	event, err := store.Publish(ctx, Event{Kind: "acquisition.ready", Title: "Ready to listen", Body: "The Hobbit", ActionURL: "/works/hobbit", CreatedAt: created}, []string{reader.ID})
	if err != nil {
		t.Fatal(err)
	}
	if count, err := store.UnreadCount(ctx, reader.ID); err != nil || count != 1 {
		t.Fatalf("reader unread = %d, %v", count, err)
	}
	if count, err := store.UnreadCount(ctx, owner.User.ID); err != nil || count != 0 {
		t.Fatalf("owner unread = %d, %v", count, err)
	}
	if err := store.MarkRead(ctx, owner.User.ID, event.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("mark another user's notification = %v", err)
	}
	if err := store.MarkRead(ctx, reader.ID, event.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkRead(ctx, reader.ID, event.ID); err != nil {
		t.Fatalf("idempotent mark read: %v", err)
	}
	items, err := store.List(ctx, reader.ID, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Title != "Ready to listen" || !items[0].CreatedAt.Equal(created) || items[0].ReadAt == nil {
		t.Fatalf("notifications = %#v", items)
	}
	if count, err := store.UnreadCount(ctx, reader.ID); err != nil || count != 0 {
		t.Fatalf("reader unread after mark = %d, %v", count, err)
	}
}

func TestMarkAllRead(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	accounts, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	owner, err := accounts.Setup(ctx, auth.Credentials{Username: "owner", Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	store := New(db)
	for _, title := range []string{"First", "Second"} {
		if _, err := store.Publish(ctx, Event{Kind: "request.updated", Title: title}, []string{owner.User.ID}); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.MarkAllRead(ctx, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	if count, err := store.UnreadCount(ctx, owner.User.ID); err != nil || count != 0 {
		t.Fatalf("unread = %d, %v", count, err)
	}
}

func TestPublishWithStableIDIsIdempotent(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	accounts, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	owner, err := accounts.Setup(ctx, auth.Credentials{Username: "owner", Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	store := New(db)
	event := Event{ID: "stable-event", Kind: "acquisition.available", Title: "Ready to read"}
	for range 2 {
		if _, err := store.Publish(ctx, event, []string{owner.User.ID}); err != nil {
			t.Fatal(err)
		}
	}
	items, err := store.List(ctx, owner.User.ID, 10, 0)
	if err != nil || len(items) != 1 || items[0].ID != event.ID {
		t.Fatalf("notifications=%#v err=%v", items, err)
	}
}
