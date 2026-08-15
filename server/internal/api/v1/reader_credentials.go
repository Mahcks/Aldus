package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/auth"
)

func registerReaderCredentialRoutes(router chi.Router, store *auth.Store) {
	router.Get("/me/reader-credentials", listReaderCredentials(store))
	router.Post("/me/reader-credentials", createReaderCredential(store))
	router.Delete("/me/reader-credentials/{credentialID}", deleteReaderCredential(store))
}

func listReaderCredentials(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values, err := store.ReaderCredentials(r.Context(), actor(r))
		if err != nil {
			writeAuthResult(w, nil, err)
			return
		}
		items := make([]contracts.ReaderCredential, len(values))
		for i, value := range values {
			items[i] = contracts.ReaderCredential{ID: value.ID, Label: value.Label, LastUsedAt: value.LastUsed, CreatedAt: value.CreatedAt}
		}
		writeJSON(w, http.StatusOK, items)
	}
}

func createReaderCredential(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.CreateReaderCredentialRequest
		if !decode(w, r, &body) {
			return
		}
		value, err := store.CreateReaderCredential(r.Context(), actor(r), body.Label)
		if err != nil {
			writeAuthResult(w, nil, err)
			return
		}
		writeJSON(w, http.StatusCreated, contracts.ReaderCredential{ID: value.ID, Label: value.Label, Secret: value.Secret, CreatedAt: value.CreatedAt})
	}
}

func deleteReaderCredential(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := store.DeleteReaderCredential(r.Context(), actor(r), chi.URLParam(r, "credentialID")); err != nil {
			writeAuthResult(w, nil, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
