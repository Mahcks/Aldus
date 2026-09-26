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

func TestPositionOwnershipHTTP(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "api.db"))
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
	owners := ownership.New(db)
	_, err = owners.Claim(ctx, session.User, "fixture-work", ownership.Claim{
		DeviceID: "phone", Label: "My iPhone", Platform: "ios", RequestID: "first",
	})
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(Dependencies{Auth: accounts, Catalog: catalog.New(db), Position: positions})
	for _, endpoint := range []struct{ path, payload string }{
		{"/works/fixture-work/progress", `"alignment_id":"fixture-alignment","segment_id":"s0001","offset":100,"expected_revision":0,"source_device":"web"`},
		{"/representations/fixture-audio-representation/state", `"audio_timestamp_ms":100,"expected_revision":0`},
	} {
		for _, proof := range []string{`{"device_id":"web","epoch":1}`, `{"device_id":"phone","epoch":2}`} {
			response := request(t, handler, session.Token, http.MethodPut, endpoint.path, "{"+endpoint.payload+`,"ownership":`+proof+"}")
			var conflict contracts.ReadingOwnershipConflict
			if response.Code != http.StatusConflict || json.Unmarshal(response.Body.Bytes(), &conflict) != nil {
				t.Fatalf("stale response: %d %s", response.Code, response.Body.String())
			}
			if conflict.Code != "ownership_superseded" || conflict.Owner == nil || conflict.Owner.DeviceID != "phone" {
				t.Fatalf("wrong owner: %#v", conflict)
			}
		}
		malformed := request(t, handler, session.Token, http.MethodPut, endpoint.path, "{"+endpoint.payload+`,"ownership":{}}`)
		if malformed.Code != http.StatusBadRequest {
			t.Fatalf("empty proof: %d %s", malformed.Code, malformed.Body.String())
		}
		accepted := request(t, handler, session.Token, http.MethodPut, endpoint.path, "{"+endpoint.payload+`,"ownership":{"device_id":"phone","epoch":1}}`)
		if accepted.Code != http.StatusOK {
			t.Fatalf("owner save: %d %s", accepted.Code, accepted.Body.String())
		}
		revision := request(t, handler, session.Token, http.MethodPut, endpoint.path, "{"+endpoint.payload+`,"ownership":{"device_id":"phone","epoch":1}}`)
		if revision.Code != http.StatusConflict {
			t.Fatalf("revision check lost: %d", revision.Code)
		}
		var body map[string]any
		if err := json.Unmarshal(revision.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body["code"] != nil || body["revision"] != float64(1) {
			t.Fatalf("revision contract changed: %#v", body)
		}
	}
}
