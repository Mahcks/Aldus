package position

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/ownership"
)

func TestResetFencesPositionsPreservesPreferencesAndRetriesOnce(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	user := auth.User{ID: addFixtureUser(t, store)}
	owners := ownership.New(store.db)
	claim := ownership.Claim{DeviceID: "phone", Label: "Phone", Platform: "ios", RequestID: "opening"}
	first, err := owners.Claim(ctx, user, "fixture-work", claim)
	if err != nil {
		t.Fatal(err)
	}
	proof := ownership.Proof{DeviceID: first.DeviceID, Epoch: first.Epoch}
	update := Update{Ownership: proof, SegmentID: "s0001", Offset: 500000, SourceDevice: "phone"}
	saved, err := store.UpdateProgress(ctx, user.ID, "fixture-work", FixtureAlignmentID, update)
	if err != nil {
		t.Fatal(err)
	}
	audio := int64(5000)
	speed := 1.5
	editionUpdate := RepresentationUpdate{Ownership: proof, AudioTimestampMS: &audio, PlaybackSpeed: &speed}
	edition, err := store.UpdateRepresentationState(ctx, user.ID, "fixture-audio-representation", editionUpdate)
	if err != nil {
		t.Fatal(err)
	}
	activity, err := store.StartActivity(ctx, user.ID, "fixture-work", "listen")
	if err != nil {
		t.Fatal(err)
	}
	other := addFixtureUserNamed(t, store, "other-user", "other-reader")
	otherSaved, err := store.UpdateProgress(ctx, other, "fixture-work", FixtureAlignmentID, Update{SegmentID: "s0001", Offset: 700000, SourceDevice: "other"})
	if err != nil {
		t.Fatal(err)
	}
	claim.RequestID = "reset"
	claim.ExpectedEpoch = first.Epoch
	reset := func(ctx context.Context, tx *sql.Tx) error { return ResetTx(ctx, tx, user.ID, "fixture-work") }
	next, err := owners.ResetWithClaim(ctx, user, "fixture-work", claim, reset, nil)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := owners.ResetWithClaim(ctx, user, "fixture-work", claim, reset, nil)
	if err != nil || retry.Epoch != next.Epoch {
		t.Fatalf("retry: %#v %v", retry, err)
	}
	progress, err := store.Progress(ctx, user.ID, "fixture-work")
	if err != nil || progress.AlignmentID != "" || progress.SegmentID != "" || progress.Revision != saved.Revision+1 || *progress.Resolvable {
		t.Fatalf("reset position: %#v %v", progress, err)
	}
	resetEdition, err := store.RepresentationState(ctx, user.ID, "fixture-audio-representation")
	if err != nil || resetEdition.AudioTimestampMS != nil || resetEdition.Revision != edition.Revision+1 || resetEdition.PlaybackSpeed == nil || *resetEdition.PlaybackSpeed != speed {
		t.Fatalf("reset edition: %#v %v", resetEdition, err)
	}
	if _, err := store.UpdateActivity(ctx, user.ID, activity.ID, 10, true); err != nil {
		t.Fatalf("history removed: %v", err)
	}
	otherAfter, err := store.Progress(ctx, other, "fixture-work")
	if err != nil || otherAfter.Revision != otherSaved.Revision || otherAfter.Offset != otherSaved.Offset {
		t.Fatalf("changed another reader: %#v %v", otherAfter, err)
	}
	book, err := catalog.New(store.db).WorkDetail(ctx, user, "fixture-work")
	if err != nil || book.InProgress {
		t.Fatalf("reset still in continue reading: %#v %v", book, err)
	}
	if _, err := store.UpdateRepresentationState(ctx, user.ID, "fixture-epub-representation", RepresentationUpdate{EPUBLocator: []byte(`{"href":"old.xhtml"}`)}); !errors.Is(err, ErrConflict) {
		t.Fatalf("pending first edition save survived reset: %v", err)
	}
	update.ExpectedRevision = saved.Revision
	_, err = store.UpdateProgress(ctx, user.ID, "fixture-work", FixtureAlignmentID, update)
	var superseded *ownership.Superseded
	if !errors.As(err, &superseded) {
		t.Fatalf("old owner accepted: %v", err)
	}
	update.Ownership = ownership.Proof{}
	if _, err := store.UpdateProgress(ctx, user.ID, "fixture-work", FixtureAlignmentID, update); !errors.Is(err, ErrConflict) {
		t.Fatalf("old revision accepted: %v", err)
	}
	editionUpdate.Ownership = ownership.Proof{}
	editionUpdate.ExpectedRevision = edition.Revision
	if _, err := store.UpdateRepresentationState(ctx, user.ID, "fixture-audio-representation", editionUpdate); !errors.Is(err, ErrConflict) {
		t.Fatalf("old edition accepted: %v", err)
	}
	update.Ownership = ownership.Proof{DeviceID: next.DeviceID, Epoch: next.Epoch}
	update.ExpectedRevision = progress.Revision
	if _, err := store.UpdateProgress(ctx, user.ID, "fixture-work", FixtureAlignmentID, update); err != nil {
		t.Fatalf("fresh save refused: %v", err)
	}
	claim.RequestID = "second-reset"
	claim.ExpectedEpoch = next.Epoch
	if _, err := owners.ResetWithClaim(ctx, user, "fixture-work", claim, reset, nil); err != nil {
		t.Fatal(err)
	}
	twice, err := store.Progress(ctx, user.ID, "fixture-work")
	if err != nil || twice.Revision != progress.Revision+2 {
		t.Fatalf("revision reused: %#v %v", twice, err)
	}
}

func TestResetAuthorizationAndRollback(t *testing.T) {
	ctx := context.Background()
	store := testStore(t)
	user := auth.User{ID: addFixtureUser(t, store)}
	owners := ownership.New(store.db)
	claim := ownership.Claim{DeviceID: "web", Label: "Web", Platform: "web", RequestID: "reset"}
	reset := func(ctx context.Context, tx *sql.Tx) error { return ResetTx(ctx, tx, user.ID, "fixture-work") }
	if _, err := owners.ResetWithClaim(ctx, user, "no-such-work", claim, reset, nil); !errors.Is(err, ownership.ErrNotFound) {
		t.Fatalf("missing work: %v", err)
	}
	if _, err := store.db.Exec(`DELETE FROM library_members WHERE user_id = ?`, user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := owners.ResetWithClaim(ctx, user, "fixture-work", claim, reset, nil); !errors.Is(err, ownership.ErrNotFound) {
		t.Fatalf("unauthorized reset: %v", err)
	}
	addFixtureUser(t, store)
	invalidClaim := claim
	invalidClaim.RequestID = ""
	if _, err := owners.ResetWithClaim(ctx, user, "fixture-work", invalidClaim, reset, nil); !errors.Is(err, ownership.ErrInvalid) {
		t.Fatalf("empty reset request accepted: %v", err)
	}
	// A successful reset must still roll back when capturing its response fails.
	failed := errors.New("failed snapshot")
	if _, err := owners.ResetWithClaim(ctx, user, "fixture-work", claim, reset, func(context.Context, *sql.Tx) error { return failed }); !errors.Is(err, failed) {
		t.Fatal(err)
	}
	if _, err := store.Progress(ctx, user.ID, "fixture-work"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reset committed: %v", err)
	}
	owner, err := owners.Get(ctx, user, "fixture-work")
	if err != nil || owner != nil {
		t.Fatalf("ownership committed: %#v %v", owner, err)
	}
}
