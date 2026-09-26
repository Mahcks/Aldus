package position

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/ownership"
)

func TestOwnershipRejectsStaleSavesBeforeRevision(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	actor := auth.User{ID: addFixtureUser(t, store)}
	owners := ownership.New(store.db)
	first, err := owners.Claim(ctx, actor, "fixture-work", ownership.Claim{
		DeviceID: "web", Label: "Browser", Platform: "web", RequestID: "first",
	})
	if err != nil {
		t.Fatal(err)
	}
	proof := ownership.Proof{DeviceID: first.DeviceID, Epoch: first.Epoch}
	update := Update{SegmentID: "s0001", Offset: 100, SourceDevice: "web", Ownership: proof}
	original, err := store.UpdateProgress(ctx, actor.ID, "fixture-work", FixtureAlignmentID, update)
	if err != nil {
		t.Fatal(err)
	}
	audio := int64(500)
	edition := RepresentationUpdate{AudioTimestampMS: &audio, Ownership: proof}
	originalEdition, err := store.UpdateRepresentationState(ctx, actor.ID, "fixture-audio-representation", edition)
	if err != nil {
		t.Fatal(err)
	}
	next, err := owners.Claim(ctx, actor, "fixture-work", ownership.Claim{
		DeviceID: "phone", Label: "Phone", Platform: "ios", RequestID: "second", ExpectedEpoch: first.Epoch,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Both expected revisions are deliberately stale too: ownership wins.
	_, err = store.UpdateProgress(ctx, actor.ID, "fixture-work", FixtureAlignmentID, update)
	assertSuperseded(t, err, next.DeviceID)
	_, err = store.UpdateRepresentationState(ctx, actor.ID, "fixture-audio-representation", edition)
	assertSuperseded(t, err, next.DeviceID)
	got, err := store.Progress(ctx, actor.ID, "fixture-work")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, original) {
		t.Fatalf("rejected save changed progress: %#v", got)
	}
	gotEdition, err := store.RepresentationState(ctx, actor.ID, "fixture-audio-representation")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(gotEdition, originalEdition) {
		t.Fatalf("rejected save changed representation: %#v", gotEdition)
	}

	// Legacy callers retain the existing optimistic-revision behavior.
	update.Ownership = ownership.Proof{}
	update.SourceDeviceID = "koreader-device"
	update.ExpectedRevision = original.Revision
	if _, err := store.UpdateProgress(ctx, actor.ID, "fixture-work", FixtureAlignmentID, update); err != nil {
		t.Fatal(err)
	}
	edition.Ownership = ownership.Proof{}
	edition.ExpectedRevision = originalEdition.Revision
	if _, err := store.UpdateRepresentationState(ctx, actor.ID, "fixture-audio-representation", edition); err != nil {
		t.Fatal(err)
	}
}

func assertSuperseded(t *testing.T, err error, device string) {
	t.Helper()
	var stale *ownership.Superseded
	if !errors.As(err, &stale) || stale.Owner == nil || stale.Owner.DeviceID != device {
		t.Fatalf("expected superseded by %s, got %v", device, err)
	}
}

func TestOwnershipTakeoverFencesContendingSaves(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "race.db")
	store, err := openTestStore(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.SeedFixture(ctx); err != nil {
		t.Fatal(err)
	}
	actor := auth.User{ID: addFixtureUser(t, store)}
	secondDB, err := database.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer secondDB.Close()
	thirdDB, err := database.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer thirdDB.Close()
	owners := ownership.New(secondDB)
	first, err := owners.Claim(ctx, actor, "fixture-work", ownership.Claim{
		DeviceID: "web", Label: "Browser", Platform: "web", RequestID: "first",
	})
	if err != nil {
		t.Fatal(err)
	}

	// Hold SQLite's write lock while replacing ownership. Both saves start at
	// a barrier before that transaction commits, on independent connections.
	tx, err := secondDB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := ownership.LockTx(ctx, tx, actor.ID, "fixture-work"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE reading_owners SET epoch = epoch + 1 WHERE user_id = ?", actor.ID); err != nil {
		t.Fatal(err)
	}

	ready := make(chan struct{}, 2)
	start := make(chan struct{})
	results := make(chan error, 2)
	for index, writer := range []*Store{store, New(thirdDB)} {
		go func(writer *Store, epoch int64) {
			ready <- struct{}{}
			<-start
			_, err := writer.UpdateProgress(ctx, actor.ID, "fixture-work", FixtureAlignmentID, Update{
				SegmentID: "s0001", Offset: 100, SourceDevice: "web",
				Ownership: ownership.Proof{DeviceID: first.DeviceID, Epoch: epoch},
			})
			results <- err
		}(writer, first.Epoch+int64(index))
	}
	<-ready
	<-ready
	close(start)
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	successes, superseded := 0, 0
	for range 2 {
		err := <-results
		var stale *ownership.Superseded
		if err == nil {
			successes++
		} else if errors.As(err, &stale) {
			superseded++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || superseded != 1 {
		t.Fatalf("success=%d superseded=%d", successes, superseded)
	}
	saved, err := store.Progress(ctx, actor.ID, "fixture-work")
	if err != nil || saved.Revision != 1 {
		t.Fatalf("progress=%#v err=%v", saved, err)
	}
}
