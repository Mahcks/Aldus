package v1

import (
	"net/http"

	"github.com/mahcks/aldus/server/internal/acquisition"
	"github.com/mahcks/aldus/server/internal/api/contracts"
)

func searchTitles(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values, err := store.SearchTitles(r.Context(), actor(r), r.URL.Query().Get("q"), r.URL.Query().Get("library_id"))
		out := make([]contracts.TitleSearchResult, len(values))
		for i, value := range values {
			out[i] = contracts.TitleSearchResult{WorkID: value.WorkID, LibraryID: value.LibraryID, Title: value.Title, Author: value.Author, CoverURL: value.CoverURL, ExternalSource: value.ExternalSource, ExternalID: value.ExternalID, Readable: value.Readable, Listenable: value.Listenable, Synchronized: value.Synchronized, EbookRequestState: value.EbookRequestState, AudiobookRequestState: value.AudiobookRequestState}
		}
		writeAcquisitionResult(w, out, err)
	}
}
