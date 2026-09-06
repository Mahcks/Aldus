package v1

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/mahcks/aldus/server/internal/api/contracts"
)

func TestRequestOnlyReaderCannotUseReleaseRoutes(t *testing.T) {
	handler, owner := testHandler(t)
	created := request(t, handler, owner, http.MethodPost, "/users", `{"username":"request-reader","password":"test-password-for-reader","admin":false}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create user: %d", created.Code)
	}
	var account contracts.CreatedUser
	if err := json.Unmarshal(created.Body.Bytes(), &account); err != nil {
		t.Fatal(err)
	}
	grant := request(t, handler, owner, http.MethodPut, "/libraries/fixture-library/members/"+account.User.ID, `{"role":"reader","can_request_acquisitions":true}`)
	if grant.Code != http.StatusNoContent {
		t.Fatalf("grant: %d %s", grant.Code, grant.Body)
	}
	login := request(t, handler, "", http.MethodPost, "/auth/login", `{"username":"request-reader","password":"test-password-for-reader"}`)
	var session struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(login.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.Token == "" {
		t.Fatal("missing login token")
	}
	for _, operation := range []struct{ method, path, body string }{
		{http.MethodPost, "/acquisition-requests", `{"source_id":"fixture-source","query":"Alice"}`},
		{http.MethodPost, "/acquisition-discoveries", `{"source_id":"fixture-source","query":"Alice"}`},
		{http.MethodGet, "/acquisition-requests/unknown/search", ""},
		{http.MethodPost, "/acquisition-requests/unknown/select", `{"result_id":"release"}`},
		{http.MethodPost, "/acquisition-discoveries/unknown/select", `{"result_id":"release"}`},
		{http.MethodPost, "/acquisition-discoveries/unknown/select-pair", `{"result_ids":["ebook","audio"]}`},
		{http.MethodPost, "/acquisition-requests/unknown/retry", ""},
	} {
		response := request(t, handler, session.Token, operation.method, "/libraries/fixture-library"+operation.path, operation.body)
		if response.Code != http.StatusNotFound && response.Code != http.StatusForbidden {
			t.Errorf("%s: status=%d body=%s", operation.path, response.Code, response.Body)
		}
	}
}
