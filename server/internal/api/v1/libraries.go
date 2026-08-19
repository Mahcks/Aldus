package v1

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/catalog"
)

func registerLibraryRoutes(router chi.Router, store *catalog.Store) {
	router.Get("/libraries", listLibraries(store))
	router.Post("/libraries", createLibrary(store))
	router.Get("/libraries/{libraryID}", getLibrary(store))
	router.Patch("/libraries/{libraryID}", updateLibrary(store))
	router.Delete("/libraries/{libraryID}", deleteLibrary(store))
	router.Get("/libraries/{libraryID}/members", listMembers(store))
	router.Put("/libraries/{libraryID}/members/{userID}", setMember(store))
	router.Delete("/libraries/{libraryID}/members/{userID}", removeMember(store))
}

func listLibraries(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset := pageParams(r)
		v, e := s.Libraries(r.Context(), actor(r), limit, offset)
		writeCatalogResult(w, libraryDTOs(v), e)
	}
}
func createLibrary(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b contracts.CreateLibraryRequest
		if !decode(w, r, &b) {
			return
		}
		v, e := s.CreateLibrary(r.Context(), actor(r), b.Name)
		if e == nil {
			writeJSON(w, http.StatusCreated, libraryDTO(v))
			return
		}
		writeCatalogResult(w, libraryDTO(v), e)
	}
}
func getLibrary(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Library(r.Context(), actor(r), chi.URLParam(r, "libraryID"))
		writeCatalogResult(w, libraryDTO(v), e)
	}
}
func updateLibrary(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b contracts.UpdateLibraryRequest
		if !decode(w, r, &b) {
			return
		}
		e := s.UpdateLibrary(r.Context(), actor(r), chi.URLParam(r, "libraryID"), b.Name)
		writeNoContent(w, e)
	}
}
func deleteLibrary(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeNoContent(w, s.DeleteLibrary(r.Context(), actor(r), chi.URLParam(r, "libraryID")))
	}
}
func listMembers(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Members(r.Context(), actor(r), chi.URLParam(r, "libraryID"))
		writeCatalogResult(w, membershipDTOs(v), e)
	}
}
func setMember(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b contracts.SetMembershipRequest
		if !decode(w, r, &b) {
			return
		}
		e := s.SetMember(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "userID"), b.Role, b.CanRequestAcquisitions, b.CanBypassAcquisitionApproval, b.CanAdvancedAcquisitionRequest)
		if e == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeCatalogResult(w, nil, e)
	}
}
func removeMember(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := s.RemoveMember(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "userID"))
		if e == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeCatalogResult(w, nil, e)
	}
}
func writeNoContent(w http.ResponseWriter, err error) {
	if err == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeCatalogResult(w, nil, err)
}
func writeCatalogResult(w http.ResponseWriter, value any, err error) {
	switch {
	case errors.Is(err, catalog.ErrNotFound), errors.Is(err, catalog.ErrForbidden):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, catalog.ErrInvalid):
		http.Error(w, "invalid catalog input", http.StatusBadRequest)
	case errors.Is(err, catalog.ErrLastOwner):
		http.Error(w, "last owner", http.StatusConflict)
	case errors.Is(err, catalog.ErrReferenced):
		http.Error(w, "resource is referenced", http.StatusConflict)
	case err != nil:
		slog.Error("catalog request failed", "error", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
	default:
		writeJSON(w, http.StatusOK, value)
	}
}
