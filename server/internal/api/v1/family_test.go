package v1

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/mahcks/aldus/server/internal/api/contracts"
)

func TestFamilyAdministrationAndSharingRoutes(t *testing.T) {
	handler, token := testHandler(t)
	response := request(t, handler, token, http.MethodPost, "/users", `{"username":"family-reader","password":"long-test-password","admin":false}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", response.Code, response.Body)
	}
	var created contracts.CreatedUser
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	target := "/users/" + created.User.ID
	if response := request(t, handler, "", http.MethodPatch, target, `{"admin":true}`); response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous role change: %d", response.Code)
	}
	if response := request(t, handler, token, http.MethodPatch, target, `{"admin":true,"disabled":false}`); response.Code != http.StatusBadRequest {
		t.Fatalf("ambiguous mutation: %d", response.Code)
	}
	if response := request(t, handler, token, http.MethodPatch, target, `{"admin":true}`); response.Code != http.StatusNoContent {
		t.Fatalf("promote: %d %s", response.Code, response.Body)
	}
	response = request(t, handler, token, http.MethodPost, "/me/collections", `{"title":"Family list","description":"Read together"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("create collection: %d %s", response.Code, response.Body)
	}
	var list contracts.Collection
	if err := json.Unmarshal(response.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if response := request(t, handler, token, http.MethodPut, "/me/collections/"+list.ID+"/sharing", `{"library_id":"fixture-library"}`); response.Code != http.StatusNoContent {
		t.Fatalf("publish: %d %s", response.Code, response.Body)
	}
	if response := request(t, handler, token, http.MethodGet, "/collections/shared/"+list.ID, ""); response.Code != http.StatusOK {
		t.Fatalf("shared: %d %s", response.Code, response.Body)
	}
	if response := request(t, handler, "", http.MethodGet, "/collections/shared/"+list.ID, ""); response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous shared: %d", response.Code)
	}
	if response := request(t, handler, token, http.MethodPut, "/me/collections/"+list.ID+"/sharing", `{"library_id":""}`); response.Code != http.StatusNoContent {
		t.Fatalf("unpublish: %d", response.Code)
	}
	if response := request(t, handler, token, http.MethodGet, "/collections/shared/"+list.ID, ""); response.Code != http.StatusNotFound {
		t.Fatalf("unpublished: %d", response.Code)
	}
}
