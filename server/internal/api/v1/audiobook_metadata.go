package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/catalog"
)

func registerAudiobookMetadataRoutes(router chi.Router, store *catalog.Store) {
	router.Get("/works/{workID}/representations/{representationID}/metadata/audiobook", func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		value, err := store.PreviewAudiobookMetadata(r.Context(), actor(r), chi.URLParam(r, "workID"), chi.URLParam(r, "representationID"), query.Get("asin"), query.Get("region"))
		result := contracts.AudiobookMetadataPreview{
			Recording:      contracts.AudiobookRecordingDetails(value.Recording),
			ASIN:           value.ASIN,
			Region:         value.Region,
			Title:          value.Title,
			Authors:        value.Authors,
			RuntimeMinutes: value.RuntimeMinutes,
			Format:         value.Format,
			Current:        contracts.AudiobookMetadataValues(value.Current),
			Values:         contracts.AudiobookMetadataValues(value.Values),
		}
		writeCatalogResult(w, result, err)
	})
	router.Post("/works/{workID}/representations/{representationID}/metadata/audiobook", func(w http.ResponseWriter, r *http.Request) {
		var body contracts.AudiobookMetadataCorrection
		if !decode(w, r, &body) {
			return
		}
		err := store.ApplyAudiobookMetadata(r.Context(), actor(r), chi.URLParam(r, "workID"), chi.URLParam(r, "representationID"), catalog.AudiobookMetadataCorrection{
			Recording: catalog.AudiobookRecordingDetails(body.Recording),
			ASIN:      body.ASIN,
			Region:    body.Region,
			Fields:    body.Fields,
			Expected:  catalog.AudiobookMetadataValues(body.Expected),
			Values:    catalog.AudiobookMetadataValues(body.Values),
		})
		writeNoContent(w, err)
	})
}
