package v1

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/source"
)

func registerSourceRoutes(r chi.Router, store *source.Store) {
	if store == nil {
		return
	}
	r.Get("/libraries/{libraryID}/sources", listSources(store))
	r.Post("/libraries/{libraryID}/sources", createSource(store))
	r.Get("/libraries/{libraryID}/sources/{sourceID}", getSource(store))
	r.Patch("/libraries/{libraryID}/sources/{sourceID}", updateSource(store))
	r.Delete("/libraries/{libraryID}/sources/{sourceID}", deleteSource(store))
}
func listSources(s *source.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values, err := s.List(r.Context(), actor(r), chi.URLParam(r, "libraryID"))
		if err != nil {
			writeSourceError(w, err)
			return
		}
		out := make([]contracts.LibrarySource, len(values))
		for i, v := range values {
			out[i] = sourceDTO(v)
		}
		writeJSON(w, http.StatusOK, out)
	}
}
func createSource(s *source.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b contracts.CreateLibrarySourceRequest
		if !decode(w, r, &b) {
			return
		}
		v, err := s.Create(r.Context(), actor(r), chi.URLParam(r, "libraryID"), b.Name, b.RootPath)
		if err != nil {
			writeSourceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, sourceDTO(v))
	}
}
func getSource(s *source.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, err := s.Get(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "sourceID"))
		if err != nil {
			writeSourceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, sourceDTO(v))
	}
}
func updateSource(s *source.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b contracts.UpdateLibrarySourceRequest
		if !decode(w, r, &b) {
			return
		}
		err := s.Update(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "sourceID"), b.Name, b.RootPath, b.Enabled)
		if err != nil {
			writeSourceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
func deleteSource(s *source.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := s.Delete(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "sourceID"))
		if err != nil {
			writeSourceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
func sourceDTO(v source.LibrarySource) contracts.LibrarySource {
	return contracts.LibrarySource{ID: v.ID, LibraryID: v.LibraryID, Kind: v.Kind, Name: v.Name, RootPath: v.RootPath, Enabled: v.Enabled, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt}
}
func writeSourceError(w http.ResponseWriter, err error) {
	if errors.Is(err, source.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if errors.Is(err, source.ErrInvalid) {
		http.Error(w, "invalid source", http.StatusBadRequest)
		return
	}
	http.Error(w, "internal server error", http.StatusInternalServerError)
}
