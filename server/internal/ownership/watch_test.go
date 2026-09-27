package ownership

import (
	"context"
	"database/sql"
	"errors"
	"runtime"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

func TestWatchCommittedTakeover(t *testing.T) {
	store, _, actor := stores(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result := make(chan *Session, 1)
	failure := make(chan error, 1)
	go func() {
		owner, err := store.Watch(ctx, actor, "work", 0, time.Minute)
		result <- owner
		failure <- err
	}()
	// Wait for registration without timing sleeps; a claim before the watch's
	// final read is intentionally allowed and must also return immediately.
	for {
		store.watchMu.Lock()
		registered := len(store.watchers) > 0
		store.watchMu.Unlock()
		if registered {
			break
		}
		if ctx.Err() != nil {
			t.Fatal("watch did not register")
		}
		runtime.Gosched()
	}
	claim := Claim{DeviceID: "phone", Label: "Phone", Platform: "ios", RequestID: "one"}
	owner, err := store.Claim(ctx, actor, "work", claim)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-result:
		if err := <-failure; err != nil || got == nil || got.Epoch != owner.Epoch {
			t.Fatalf("watch: %+v, %v", got, err)
		}
	case <-ctx.Done():
		t.Fatal("watch did not wake on commit")
	}
	store.watchMu.Lock()
	defer store.watchMu.Unlock()
	if len(store.watchers) != 0 {
		t.Fatal("watch leaked registration")
	}
}

func TestWatchIsolationRollbackAndLimits(t *testing.T) {
	store, _, actor := stores(t)
	ctx := context.Background()
	changed, cleanup, err := store.subscribe(actor.ID, "work")
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	store.notify("other-user", "work")
	store.notify(actor.ID, "other-work")
	claim := Claim{DeviceID: "phone", Label: "Phone", Platform: "ios", RequestID: "one"}
	rollback := errors.New("capture failed")
	_, err = store.ClaimWithSnapshot(ctx, actor, "work", claim, func(context.Context, *sql.Tx) error { return rollback })
	if !errors.Is(err, rollback) {
		t.Fatal(err)
	}
	select {
	case <-changed:
		t.Fatal("uncommitted or unrelated change notified")
	default:
	}
	if _, err = store.Claim(ctx, actor, "work", claim); err != nil {
		t.Fatal(err)
	}
	select {
	case <-changed:
	default:
		t.Fatal("commit did not notify")
	}
	if _, err = store.Refresh(ctx, actor, "work", Proof{DeviceID: "phone", Epoch: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Claim(ctx, actor, "work", claim); err != nil {
		t.Fatal(err)
	}
	select {
	case <-changed:
		t.Fatal("heartbeat/idempotent claim notified")
	default:
	}
	for i := 1; i < 64; i++ {
		_, remove, err := store.subscribe(actor.ID, "work")
		if err != nil {
			t.Fatal(err)
		}
		defer remove()
	}
	if _, _, err = store.subscribe(actor.ID, "work"); !errors.Is(err, ErrWatchLimit) {
		t.Fatal("missing user limit")
	}
}

func TestWatchImmediateTimeoutCancellationAndAuthorization(t *testing.T) {
	store, _, actor := stores(t)
	ctx := context.Background()
	if _, err := store.Watch(ctx, auth.User{ID: "stranger"}, "work", 0, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unauthorized: %v", err)
	}
	if _, err := store.Watch(ctx, actor, "work", -1, 0); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	if owner, err := store.Watch(ctx, actor, "work", 0, 0); err != nil || owner != nil {
		t.Fatalf("timeout: %v %v", owner, err)
	}
	if owner, err := store.Watch(ctx, actor, "work", 99, time.Minute); err != nil || owner != nil {
		t.Fatalf("older server epoch: %v %v", owner, err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := store.Watch(cancelled, actor, "work", 0, time.Minute); err == nil {
		t.Fatal("cancel ignored")
	}
	if len(store.watchers) != 0 {
		t.Fatal("watch leaked registration")
	}
}

func TestPendingWatchCancellationReleasesWaiter(t *testing.T) {
	store, _, actor := stores(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := store.Watch(ctx, actor, "work", 0, time.Minute)
		done <- err
	}()
	for {
		store.watchMu.Lock()
		registered := len(store.watchers) > 0
		store.watchMu.Unlock()
		if registered {
			break
		}
		if ctx.Err() != nil {
			t.Fatal("watch did not register")
		}
		runtime.Gosched()
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
	store.watchMu.Lock()
	defer store.watchMu.Unlock()
	if len(store.watchers) != 0 {
		t.Fatal("cancelled watch leaked")
	}
}
