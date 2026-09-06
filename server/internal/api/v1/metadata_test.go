package v1

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/mahcks/aldus/server/internal/api/contracts"
)

func TestMetadataApplyAPIRequiresAuthenticationAndReportsConflict(t *testing.T) {
	handler, token := testHandler(t)
	target := "/works/fixture-work/metadata/apply"
	body := `{"work_id":"OL1W","edition_id":"OL1M","fields":["title"],"expected":{"title":"Outdated"},"values":{"title":"Corrected"}}`
	if response := request(t, handler, "", http.MethodPost, target, body); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated: %d", response.Code)
	}
	if response := request(t, handler, token, http.MethodPost, target, body); response.Code != http.StatusConflict {
		t.Fatalf("stale preview: %d %s", response.Code, response.Body.String())
	}
	original := request(t, handler, token, http.MethodGet, "/works/fixture-work", "")
	var work contracts.WorkDetail
	if err := json.Unmarshal(original.Body.Bytes(), &work); err != nil {
		t.Fatal(err)
	}
	input := contracts.ApplyMetadataRequest{WorkID: "OL1W", Fields: []string{"title"}, Expected: contracts.MetadataValues{Title: work.Title}, Values: contracts.MetadataValues{Title: "Corrected"}}
	encoded, _ := json.Marshal(input)
	if response := request(t, handler, token, http.MethodPost, target, string(encoded)); response.Code != http.StatusNoContent {
		t.Fatalf("apply: %d %s", response.Code, response.Body.String())
	}
	if response := request(t, handler, token, http.MethodGet, "/works/fixture-work/metadata/editions?provider_work_id=https://example.com", ""); response.Code != http.StatusBadRequest {
		t.Fatalf("unsafe provider ID: %d", response.Code)
	}
}
