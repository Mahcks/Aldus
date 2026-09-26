package position

import (
	"context"
	"database/sql"
	"errors"
	"reflect"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/ownership"
)

func TestTakeoverCapturesExactPositionsAndRollsBackFailedCapture(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	actor := auth.User{ID: addFixtureUser(t, store)}
	owners := ownership.New(store.db)
	original, err := store.UpdateProgress(ctx, actor.ID, "fixture-work", FixtureAlignmentID, Update{
		SegmentID: "s0001", Offset: 312345, SourceDevice: "web",
	})
	if err != nil {
		t.Fatal(err)
	}
	audio := int64(500)
	edition, err := store.UpdateRepresentationState(ctx, actor.ID, "fixture-audio-representation", RepresentationUpdate{
		AudioTimestampMS: &audio,
	})
	if err != nil {
		t.Fatal(err)
	}
	claim := ownership.Claim{DeviceID: "phone", Label: "Phone", Platform: "ios", RequestID: "snapshot"}
	captures := 0
	capture := func(ctx context.Context, tx *sql.Tx) error {
		captures++
		progress, states, err := ReadingSnapshotTx(ctx, tx, actor.ID, "fixture-work")
		if err != nil {
			return err
		}
		if !reflect.DeepEqual(progress, &original) || len(states) != 1 || !reflect.DeepEqual(states[0], edition) {
			t.Fatalf("snapshot changed coordinates/revisions: %#v %#v", progress, states)
		}
		return nil
	}
	first, err := owners.ClaimWithSnapshot(ctx, actor, "fixture-work", claim, capture)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := owners.ClaimWithSnapshot(ctx, actor, "fixture-work", claim, capture)
	if err != nil || retry.Epoch != first.Epoch || captures != 2 {
		t.Fatalf("retry = %#v, captures = %d, error = %v", retry, captures, err)
	}
	failed := errors.New("snapshot unavailable")
	claim.DeviceID = "other"
	claim.RequestID = "failed"
	claim.ExpectedEpoch = first.Epoch
	_, err = owners.ClaimWithSnapshot(ctx, actor, "fixture-work", claim, func(context.Context, *sql.Tx) error { return failed })
	if !errors.Is(err, failed) {
		t.Fatalf("capture error: %v", err)
	}
	current, err := owners.Get(ctx, actor, "fixture-work")
	if err != nil || !reflect.DeepEqual(current, first) {
		t.Fatalf("failed capture changed owner: %#v, %v", current, err)
	}
}
