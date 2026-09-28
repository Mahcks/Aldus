package v1

import (
	"net/http"
	"testing"
)

func TestFileMetadataAPIRequiresAuthAndRejectsStaleRepair(t *testing.T) {
	handler, token := testHandler(t)
	for _, path := range []string{"/media/fixture-epub/metadata", "/media/fixture-epub/metadata/apply"} {
		method := http.MethodGet
		if path == "/media/fixture-epub/metadata/apply" {
			method = http.MethodPost
		}
		if response := request(t, handler, "", method, path, `{}`); response.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated %s: %d", path, response.Code)
		}
	}
	body := `{"fields":["title"],"expected":{"values":{"title":"Stale"}},"values":{"values":{"title":"Changed"}}}`
	if response := request(t, handler, token, http.MethodPost, "/media/fixture-epub/metadata/apply", body); response.Code != http.StatusConflict {
		t.Fatalf("stale: %d %s", response.Code, response.Body.String())
	}
	if response := request(t, handler, token, http.MethodPost, "/media/missing/metadata/apply", body); response.Code != http.StatusNotFound {
		t.Fatalf("missing: %d", response.Code)
	}
}
