package v1

import (
	"net/http"

	"github.com/mahcks/aldus/server/internal/acquisition"
	"github.com/mahcks/aldus/server/internal/api/contracts"
)

func searchTitles(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		report, err := store.SearchTitleReport(r.Context(), actor(r), r.URL.Query().Get("q"), r.URL.Query().Get("scope") == "local", r.URL.Query().Get("library_id"))
		values := report.Results
		out := make([]contracts.TitleSearchResult, len(values))
		for i, value := range values {
			out[i] = contracts.TitleSearchResult{
				Description:           value.Description,
				WorkID:                value.WorkID,
				LibraryID:             value.LibraryID,
				Title:                 value.Title,
				Author:                value.Author,
				CoverURL:              value.CoverURL,
				ExternalSource:        value.ExternalSource,
				ExternalID:            value.ExternalID,
				Readable:              value.Readable,
				Listenable:            value.Listenable,
				Synchronized:          value.Synchronized,
				EbookRequestState:     value.EbookRequestState,
				AudiobookRequestState: value.AudiobookRequestState,
			}
		}
		if r.URL.Query().Get("report") == "1" {
			writeAcquisitionResult(w, contracts.TitleSearchReport{Results: out, ExternalStatus: report.ExternalStatus}, err)
			return
		}
		writeAcquisitionResult(w, out, err)
	}
}
