package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/acquisition"
	"github.com/mahcks/aldus/server/internal/api/contracts"
)

func registerAcquisitionPolicyRoutes(router chi.Router, store *acquisition.PolicyStore) {
	router.Get("/libraries/{libraryID}/acquisition-policy", getAcquisitionPolicy(store))
	router.Put("/libraries/{libraryID}/acquisition-policy", updateAcquisitionPolicy(store))
}

func getAcquisitionPolicy(store *acquisition.PolicyStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := store.Get(r.Context(), actor(r), chi.URLParam(r, "libraryID"))
		writeAcquisitionResult(w, acquisitionPolicyDTO(value), err)
	}
}

func updateAcquisitionPolicy(store *acquisition.PolicyStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.UpdateAcquisitionPolicyRequest
		if !decode(w, r, &body) {
			return
		}
		value, err := store.Update(r.Context(), actor(r), acquisition.Policy{LibraryID: chi.URLParam(r, "libraryID"), DefaultEbookSourceID: body.DefaultEbookSourceID, DefaultAudiobookSourceID: body.DefaultAudiobookSourceID, MaxEbookBytes: body.MaxEbookBytes, MaxAudiobookBytes: body.MaxAudiobookBytes, AllowedEbookExtensions: body.AllowedEbookExtensions, AllowedAudiobookExtensions: body.AllowedAudiobookExtensions, PreferredLanguage: body.PreferredLanguage, AllowAbridged: body.AllowAbridged, MaxActiveRequests: body.MaxActiveRequests})
		writeAcquisitionResult(w, acquisitionPolicyDTO(value), err)
	}
}

func acquisitionPolicyDTO(value acquisition.Policy) contracts.AcquisitionPolicy {
	return contracts.AcquisitionPolicy{LibraryID: value.LibraryID, DefaultEbookSourceID: value.DefaultEbookSourceID, DefaultAudiobookSourceID: value.DefaultAudiobookSourceID, MaxEbookBytes: value.MaxEbookBytes, MaxAudiobookBytes: value.MaxAudiobookBytes, AllowedEbookExtensions: value.AllowedEbookExtensions, AllowedAudiobookExtensions: value.AllowedAudiobookExtensions, PreferredLanguage: value.PreferredLanguage, AllowAbridged: value.AllowAbridged, MaxActiveRequests: value.MaxActiveRequests, UpdatedAt: value.UpdatedAt}
}
