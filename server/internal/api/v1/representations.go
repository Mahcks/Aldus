package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/catalog"
)

func registerRepresentationRoutes(router chi.Router, store *catalog.Store) {
	router.Get("/works/{workID}/representations", listRepresentations(store))
	router.Post("/works/{workID}/representations", createRepresentation(store))
	router.Get("/representations/{representationID}", getRepresentation(store))
	router.Patch("/representations/{representationID}", updateRepresentation(store))
	router.Delete("/representations/{representationID}", deleteRepresentation(store))
}

func listRepresentations(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset := pageParams(r)
		v, e := s.Representations(r.Context(), actor(r), chi.URLParam(r, "workID"), limit, offset)
		writeCatalogResult(w, representationDTOs(v), e)
	}
}
func createRepresentation(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b contracts.CreateRepresentationRequest
		if !decode(w, r, &b) {
			return
		}
		v, e := s.CreateRepresentation(r.Context(), actor(r), chi.URLParam(r, "workID"), b.Kind, b.Label)
		if e == nil {
			writeJSON(w, http.StatusCreated, representationDTO(v))
			return
		}
		writeCatalogResult(w, representationDTO(v), e)
	}
}
func getRepresentation(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Representation(r.Context(), actor(r), chi.URLParam(r, "representationID"))
		writeCatalogResult(w, representationDTO(v), e)
	}
}
func updateRepresentation(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b contracts.UpdateRepresentationRequest
		if !decode(w, r, &b) {
			return
		}
		writeNoContent(w, s.UpdateRepresentation(r.Context(), actor(r), chi.URLParam(r, "representationID"), b.Kind, b.Label, b.Narrators))
	}
}
func deleteRepresentation(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeNoContent(w, s.DeleteRepresentation(r.Context(), actor(r), chi.URLParam(r, "representationID")))
	}
}
