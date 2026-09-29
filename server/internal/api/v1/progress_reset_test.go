package v1

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/ownership"
	"github.com/mahcks/aldus/server/internal/position"
)

func TestProgressResetResponseAndOwnershipFence(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "reset.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	positions := position.New(db)
	if err := positions.SeedFixture(ctx); err != nil {
		t.Fatal(err)
	}
	accounts, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	session, err := accounts.Setup(ctx, auth.Credentials{Username: "reader", Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(Dependencies{
		Auth:      accounts,
		Catalog:   catalog.New(db),
		Position:  positions,
		Ownership: ownership.New(db),
	})
	const path = "/works/fixture-work/progress/reset"
	const body = `{"device_id":"phone","label":"Phone","platform":"ios","request_id":"reset-1","expected_epoch":0}`
	for i := 0; i < 2; i++ {
		response := request(t, handler, session.Token, http.MethodPost, path, body)
		var snapshot contracts.ReadingClaim
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &snapshot) != nil {
			t.Fatalf("reset response: %d %s", response.Code, response.Body)
		}
		if snapshot.ResetEpoch != 1 || snapshot.Progress == nil || !snapshot.Progress.Reset || snapshot.Progress.Revision != 1 || len(snapshot.RepresentationStates) != 2 {
			t.Fatalf("snapshot: %#v", snapshot)
		}
	}
	stale := request(t, handler, session.Token, http.MethodPost, "/works/fixture-work/reading-session/heartbeat", `{"device_id":"phone","epoch":2}`)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale heartbeat: %d %s", stale.Code, stale.Body)
	}
	unauthenticated := request(t, handler, "", http.MethodPost, path, body)
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated reset: %d", unauthenticated.Code)
	}
}
