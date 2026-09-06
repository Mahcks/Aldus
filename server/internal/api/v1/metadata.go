package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/catalog"
)

func registerMetadataRoutes(router chi.Router, store *catalog.Store) {
	router.Get("/works/{workID}/metadata/candidates", func(w http.ResponseWriter, r *http.Request) {
		value, err := store.SearchMetadata(r.Context(), actor(r), chi.URLParam(r, "workID"), r.URL.Query().Get("q"))
		writeCatalogResult(w, metadataPreviewDTO(value), err)
	})
	router.Get("/works/{workID}/metadata/editions", func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		value, err := store.MetadataEditions(r.Context(), actor(r), chi.URLParam(r, "workID"), query.Get("provider_work_id"), query.Get("language"), query.Get("isbn"))
		writeCatalogResult(w, metadataPreviewDTO(value), err)
	})
	router.Post("/works/{workID}/metadata/apply", func(w http.ResponseWriter, r *http.Request) {
		var body contracts.ApplyMetadataRequest
		if !decode(w, r, &body) {
			return
		}
		err := store.ApplyMetadata(r.Context(), actor(r), chi.URLParam(r, "workID"), catalog.MetadataCorrection{
			WorkID:    body.WorkID,
			EditionID: body.EditionID,
			Fields:    body.Fields,
			Expected:  catalog.MetadataValues(body.Expected),
			Values:    catalog.MetadataValues(body.Values),
		})
		writeNoContent(w, err)
	})
}

func metadataPreviewDTO(value catalog.MetadataPreview) contracts.MetadataPreview {
	candidates := make([]contracts.MetadataCandidate, 0, len(value.Candidates))
	for _, candidate := range value.Candidates {
		candidates = append(candidates, contracts.MetadataCandidate{
			WorkID:    candidate.WorkID,
			EditionID: candidate.EditionID,
			Values:    contracts.MetadataValues(candidate.Values),
		})
	}
	return contracts.MetadataPreview{Current: contracts.MetadataValues(value.Current), Candidates: candidates}
}
