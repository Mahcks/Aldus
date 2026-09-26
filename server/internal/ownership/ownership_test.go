package ownership

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func stores(t *testing.T) (*Store, *Store, auth.User) {
	t.Helper()
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "owners.db")
	first, err := database.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { first.Close() })
	_, err = first.ExecContext(ctx, `
 INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at)
 VALUES('user','reader','reader','Reader','unused',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
 INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','','');
 INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('library','user','reader','');
 INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('work','library','Book','','');
 `)
	if err != nil {
		t.Fatal(err)
	}
	second, err := database.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { second.Close() })
	return New(first), New(second), auth.User{ID: "user"}
}

func TestConcurrentClaimAndIdempotentRetry(t *testing.T) {
	first, second, actor := stores(t)
	ctx := context.Background()
	start := make(chan struct{})
	type result struct {
		value *Session
		err   error
		claim Claim
		store *Store
	}
	results := make(chan result, 2)
	for index, store := range []*Store{first, second} {
		device := []string{"web", "phone"}[index]
		go func() {
			claim := Claim{DeviceID: device, Label: device, Platform: "web", RequestID: device}
			<-start
			value, err := store.Claim(ctx, actor, "work", claim)
			results <- result{value, err, claim, store}
		}()
	}
	close(start)
	var winner result
	successes, conflicts := 0, 0
	for range 2 {
		got := <-results
		var stale *Superseded
		if got.err == nil {
			successes++
			winner = got
		} else if errors.As(got.err, &stale) {
			conflicts++
			if stale.Owner == nil || stale.Owner.Epoch != 1 {
				t.Fatalf("missing winner: %#v", stale)
			}
		} else {
			t.Fatal(got.err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("success=%d conflict=%d", successes, conflicts)
	}
	retry, err := winner.store.Claim(ctx, actor, "work", winner.claim)
	if err != nil || retry.Epoch != winner.value.Epoch {
		t.Fatalf("retry=%#v err=%v", retry, err)
	}
	if _, err := first.Refresh(ctx, actor, "work", Proof{DeviceID: winner.value.DeviceID, Epoch: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := first.Refresh(ctx, actor, "work", Proof{DeviceID: "stale", Epoch: 1}); err == nil {
		t.Fatal("stale heartbeat accepted")
	}
	// An absent owner is a normal, side-effect-free response.
	if _, err := first.Get(ctx, auth.User{ID: "other"}, "work"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unauthorized read: %v", err)
	}
	if _, err := first.Claim(ctx, auth.User{ID: "other"}, "work", winner.claim); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unauthorized claim: %v", err)
	}
}

func TestNoRowLockAcquiresSQLiteWriteLock(t *testing.T) {
	first, second, _ := stores(t)
	ctx := context.Background()
	// Force immediate SQLITE_BUSY rather than sleeping while the first lock is held.
	if _, err := second.db.ExecContext(ctx, "PRAGMA busy_timeout = 0"); err != nil {
		t.Fatal(err)
	}
	tx, err := first.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := LockTx(ctx, tx, "absent", "absent"); err != nil {
		t.Fatal(err)
	}
	other, err := second.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Rollback()
	err = LockTx(ctx, other, "absent", "absent")
	var coded interface{ Code() int }
	if !errors.As(err, &coded) || coded.Code() != 5 {
		t.Fatalf("expected SQLITE_BUSY, got %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := LockTx(ctx, other, "absent", "absent"); err != nil {
		t.Fatal(err)
	}
}

func TestSessionReadAndMalformedProof(t *testing.T) {
	store, _, actor := stores(t)
	ctx := context.Background()
	got, err := store.Get(ctx, actor, "work")
	if err != nil || got != nil {
		t.Fatalf("empty session=%#v err=%v", got, err)
	}
	for _, proof := range []Proof{{Epoch: 1}, {DeviceID: "web"}, {DeviceID: "web", Epoch: -1}} {
		func() {
			tx, err := store.db.BeginTx(ctx, &sql.TxOptions{})
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			if err := CheckTx(ctx, tx, actor.ID, "work", proof); !errors.Is(err, ErrInvalid) {
				t.Fatalf("proof=%#v err=%v", proof, err)
			}
		}()
	}
}
