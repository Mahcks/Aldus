package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/ingest"
)

func registerFileMetadataRoutes(router chi.Router, store *catalog.Store, media *ingest.Store) {
	router.Get("/media/{mediaID}/metadata", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "mediaID")
		current, err := store.FileMetadataCurrent(r.Context(), actor(r), id)
		if err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		extracted, err := media.FileMetadata(r.Context(), actor(r), id)
		if err != nil {
			http.Error(w, "Could not read metadata from this file.", http.StatusUnprocessableEntity)
			return
		}
		suggested := catalog.FileMetadataValues{Values: extracted.Values, Series: extracted.Series, SeriesPosition: extracted.SeriesPosition, Narrators: extracted.Narrators}
		writeJSON(w, http.StatusOK, contracts.FileMetadataPreview{ASIN: extracted.ASIN, Current: fileMetadataDTO(current), Suggested: fileMetadataDTO(suggested)})
	})
	router.Post("/media/{mediaID}/metadata/apply", func(w http.ResponseWriter, r *http.Request) {
		var body contracts.ApplyFileMetadataRequest
		if !decode(w, r, &body) {
			return
		}
		writeNoContent(w, store.ApplyFileMetadata(r.Context(), actor(r), chi.URLParam(r, "mediaID"), catalog.FileMetadataCorrection{
			Fields: body.Fields, Expected: fileMetadataValue(body.Expected), Values: fileMetadataValue(body.Values),
		}))
	})
}

func fileMetadataDTO(value catalog.FileMetadataValues) contracts.FileMetadataValues {
	return contracts.FileMetadataValues{Values: contracts.MetadataValues(value.Values), Series: value.Series, SeriesPosition: value.SeriesPosition, Narrators: value.Narrators}
}
func fileMetadataValue(value contracts.FileMetadataValues) catalog.FileMetadataValues {
	return catalog.FileMetadataValues{Values: catalog.MetadataValues(value.Values), Series: value.Series, SeriesPosition: value.SeriesPosition, Narrators: value.Narrators}
}
