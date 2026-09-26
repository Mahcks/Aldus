package v1

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/ownership"
	"github.com/mahcks/aldus/server/internal/position"
)

func TestReadingSessionRoutes(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "sessions.db"))
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
	const base = "/works/fixture-work/reading-session"

	claim := func(device, requestID string, expected int64) *responseRecorder {
		body := `{"device_id":"` + device + `","label":"` + device + `","platform":"web","request_id":"` +
			requestID + `","expected_epoch":` + itoa(expected) + `}`
		return newResponse(request(t, handler, session.Token, http.MethodPost, base+"/claim", body))
	}

	t.Run("an unclaimed book reports no owner and reading it changes nothing", func(t *testing.T) {
		first := request(t, handler, session.Token, http.MethodGet, base, "")
		if first.Code != http.StatusOK || first.Body.String() != "null\n" {
			t.Fatalf("unclaimed session: %d %q", first.Code, first.Body.String())
		}
		second := request(t, handler, session.Token, http.MethodGet, base, "")
		if second.Body.String() != "null\n" {
			t.Fatalf("reading the session claimed it: %q", second.Body.String())
		}
	})

	t.Run("the first claim wins epoch one", func(t *testing.T) {
		response := claim("laptop", "claim-1", 0)
		owner := response.owner(t)
		if response.code != http.StatusOK || owner.DeviceID != "laptop" || owner.Epoch != 1 {
			t.Fatalf("first claim: %d %#v", response.code, owner)
		}
	})

	t.Run("a takeover from a stale view is refused and names the owner", func(t *testing.T) {
		response := claim("phone", "claim-2", 0)
		conflict := response.conflict(t)
		if response.code != http.StatusConflict || conflict.Code != "ownership_superseded" ||
			conflict.Owner == nil || conflict.Owner.DeviceID != "laptop" {
			t.Fatalf("stale takeover: %d %#v", response.code, conflict)
		}
	})

	t.Run("a takeover from the current view moves ownership and is idempotent", func(t *testing.T) {
		response := claim("phone", "claim-3", 1)
		owner := response.owner(t)
		if response.code != http.StatusOK || owner.DeviceID != "phone" || owner.Epoch != 2 {
			t.Fatalf("takeover: %d %#v", response.code, owner)
		}
		replay := claim("phone", "claim-3", 1).owner(t)
		if replay.Epoch != 2 {
			t.Fatalf("replayed takeover changed the epoch: %#v", replay)
		}
	})

	t.Run("the reading session reports the current owner", func(t *testing.T) {
		response := request(t, handler, session.Token, http.MethodGet, base, "")
		var owner contracts.ReadingOwner
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &owner) != nil {
			t.Fatalf("session: %d %s", response.Code, response.Body.String())
		}
		if owner.DeviceID != "phone" || owner.Epoch != 2 || owner.IdleSeconds < 0 {
			t.Fatalf("owner: %#v", owner)
		}
	})

	t.Run("a heartbeat keeps the owner and refuses everyone else", func(t *testing.T) {
		current := request(t, handler, session.Token, http.MethodPost, base+"/heartbeat", `{"device_id":"phone","epoch":2}`)
		if current.Code != http.StatusOK {
			t.Fatalf("owner heartbeat: %d %s", current.Code, current.Body.String())
		}
		stale := newResponse(request(t, handler, session.Token, http.MethodPost, base+"/heartbeat", `{"device_id":"laptop","epoch":1}`))
		conflict := stale.conflict(t)
		if stale.code != http.StatusConflict || conflict.Owner == nil || conflict.Owner.DeviceID != "phone" {
			t.Fatalf("stale heartbeat: %d %#v", stale.code, conflict)
		}
	})

	t.Run("bad requests and unknown books are rejected", func(t *testing.T) {
		invalid := request(t, handler, session.Token, http.MethodPost, base+"/claim", `{"device_id":"","label":"x","platform":"web","request_id":"r","expected_epoch":0}`)
		if invalid.Code != http.StatusBadRequest {
			t.Fatalf("empty device: %d", invalid.Code)
		}
		missing := request(t, handler, session.Token, http.MethodGet, "/works/no-such-work/reading-session", "")
		if missing.Code != http.StatusNotFound {
			t.Fatalf("unknown work: %d", missing.Code)
		}
	})

	t.Run("a takeover fences the previous owner's position saves", func(t *testing.T) {
		save := request(t, handler, session.Token, http.MethodPut, "/works/fixture-work/progress",
			`{"alignment_id":"fixture-alignment","segment_id":"s0001","offset":100,"expected_revision":0,"source_device":"web","ownership":{"device_id":"laptop","epoch":1}}`)
		if save.Code != http.StatusConflict {
			t.Fatalf("stale owner save: %d %s", save.Code, save.Body.String())
		}
	})
}

type responseRecorder struct {
	code int
	body []byte
}

func newResponse(recorder *httptest.ResponseRecorder) *responseRecorder {
	return &responseRecorder{code: recorder.Code, body: recorder.Body.Bytes()}
}

func (r *responseRecorder) owner(t *testing.T) contracts.ReadingOwner {
	t.Helper()
	var claim contracts.ReadingClaim
	if err := json.Unmarshal(r.body, &claim); err != nil {
		t.Fatalf("decode owner %q: %v", r.body, err)
	}
	return claim.Owner
}

func (r *responseRecorder) conflict(t *testing.T) contracts.ReadingOwnershipConflict {
	t.Helper()
	var conflict contracts.ReadingOwnershipConflict
	if err := json.Unmarshal(r.body, &conflict); err != nil {
		t.Fatalf("decode conflict %q: %v", r.body, err)
	}
	return conflict
}

func itoa(value int64) string {
	return strconv.FormatInt(value, 10)
}
