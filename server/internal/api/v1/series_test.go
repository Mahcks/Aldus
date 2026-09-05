package v1

import (
	"encoding/json"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"net/http"
	"testing"
)

func TestSeriesContractPreservesOmittedMetadata(t *testing.T) {
	handler, token := testHandler(t)
	for _, body := range []string{`{"title":"Alice","series":"Wonderland","series_position":"0"}`, `{"title":"Alice renamed"}`} {
		response := request(t, handler, token, http.MethodPatch, "/works/fixture-work", body)
		if response.Code != http.StatusNoContent {
			t.Fatalf("patch %d %s", response.Code, response.Body.String())
		}
	}
	response := request(t, handler, token, http.MethodGet, "/works/fixture-work", "")
	var work contracts.WorkDetail
	if err := json.Unmarshal(response.Body.Bytes(), &work); err != nil {
		t.Fatal(err)
	}
	if work.Series != "Wonderland" || work.SeriesPosition != "0" {
		t.Fatalf("omission lost metadata: %+v", work)
	}
	response = request(t, handler, token, http.MethodGet, "/catalog/series", "")
	var page contracts.CatalogGroupPage
	if response.Code != 200 {
		t.Fatalf("groups %d %s", response.Code, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].WorkCount != 1 {
		t.Fatalf("groups %+v", page)
	}
	response = request(t, handler, "", http.MethodGet, "/catalog/series", "")
	if response.Code != http.StatusUnauthorized {
		t.Fatal("unauthenticated grouping")
	}
	response = request(t, handler, token, http.MethodPatch, "/works/fixture-work", `{"title":"Alice","series":""}`)
	if response.Code != 204 {
		t.Fatal(response.Body.String())
	}
	response = request(t, handler, token, http.MethodGet, "/works/fixture-work", "")
	work = contracts.WorkDetail{}
	if err := json.Unmarshal(response.Body.Bytes(), &work); err != nil {
		t.Fatal(err)
	}
	if work.Series != "" || work.SeriesPosition != "" {
		t.Fatal("clear failed")
	}
}
