package v1

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
)

func registerCatalogRoutes(router chi.Router, store *catalog.Store) {
	router.Get("/libraries", listLibraries(store))
	router.Post("/libraries", createLibrary(store))
	router.Get("/libraries/{libraryID}", getLibrary(store))
	router.Patch("/libraries/{libraryID}", updateLibrary(store))
	router.Delete("/libraries/{libraryID}", deleteLibrary(store))
	router.Get("/libraries/{libraryID}/members", listMembers(store))
	router.Put("/libraries/{libraryID}/members/{userID}", setMember(store))
	router.Delete("/libraries/{libraryID}/members/{userID}", removeMember(store))
	router.Get("/libraries/{libraryID}/works", listWorks(store))
	router.Post("/libraries/{libraryID}/works", createWork(store))
	router.Get("/works/{workID}", getWork(store))
	router.Patch("/works/{workID}", updateWork(store))
	router.Delete("/works/{workID}", deleteWork(store))
	router.Get("/works/{workID}/representations", listRepresentations(store))
	router.Post("/works/{workID}/representations", createRepresentation(store))
	router.Get("/representations/{representationID}", getRepresentation(store))
	router.Patch("/representations/{representationID}", updateRepresentation(store))
	router.Delete("/representations/{representationID}", deleteRepresentation(store))
}

func actor(r *http.Request) auth.User { u, _ := auth.UserFromContext(r.Context()); return u }
func listLibraries(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset := pageParams(r)
		v, e := s.Libraries(r.Context(), actor(r), limit, offset)
		writeCatalogResult(w, v, e)
	}
}
func createLibrary(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Name string `json:"name"`
		}
		if !decode(w, r, &b) {
			return
		}
		v, e := s.CreateLibrary(r.Context(), actor(r), b.Name)
		if e == nil {
			writeJSON(w, http.StatusCreated, v)
			return
		}
		writeCatalogResult(w, v, e)
	}
}
func getLibrary(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Library(r.Context(), actor(r), chi.URLParam(r, "libraryID"))
		writeCatalogResult(w, v, e)
	}
}
func updateLibrary(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Name string `json:"name"`
		}
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
		writeCatalogResult(w, v, e)
	}
}
func setMember(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Role string `json:"role"`
		}
		if !decode(w, r, &b) {
			return
		}
		e := s.SetMember(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "userID"), b.Role)
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
func listWorks(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset := pageParams(r)
		v, e := s.Works(r.Context(), actor(r), chi.URLParam(r, "libraryID"), limit, offset)
		writeCatalogResult(w, v, e)
	}
}
func createWork(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Title  string `json:"title"`
			Author string `json:"author"`
		}
		if !decode(w, r, &b) {
			return
		}
		v, e := s.CreateWork(r.Context(), actor(r), chi.URLParam(r, "libraryID"), b.Title, b.Author)
		if e == nil {
			writeJSON(w, http.StatusCreated, v)
			return
		}
		writeCatalogResult(w, v, e)
	}
}
func getWork(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Work(r.Context(), actor(r), chi.URLParam(r, "workID"))
		writeCatalogResult(w, v, e)
	}
}
func updateWork(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Title  string `json:"title"`
			Author string `json:"author"`
		}
		if !decode(w, r, &b) {
			return
		}
		writeNoContent(w, s.UpdateWork(r.Context(), actor(r), chi.URLParam(r, "workID"), b.Title, b.Author))
	}
}
func deleteWork(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeNoContent(w, s.DeleteWork(r.Context(), actor(r), chi.URLParam(r, "workID")))
	}
}
func listRepresentations(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset := pageParams(r)
		v, e := s.Representations(r.Context(), actor(r), chi.URLParam(r, "workID"), limit, offset)
		writeCatalogResult(w, v, e)
	}
}
func createRepresentation(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Kind  string `json:"kind"`
			Label string `json:"label"`
		}
		if !decode(w, r, &b) {
			return
		}
		v, e := s.CreateRepresentation(r.Context(), actor(r), chi.URLParam(r, "workID"), b.Kind, b.Label)
		if e == nil {
			writeJSON(w, http.StatusCreated, v)
			return
		}
		writeCatalogResult(w, v, e)
	}
}
func getRepresentation(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Representation(r.Context(), actor(r), chi.URLParam(r, "representationID"))
		writeCatalogResult(w, v, e)
	}
}
func updateRepresentation(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Kind  string `json:"kind"`
			Label string `json:"label"`
		}
		if !decode(w, r, &b) {
			return
		}
		writeNoContent(w, s.UpdateRepresentation(r.Context(), actor(r), chi.URLParam(r, "representationID"), b.Kind, b.Label))
	}
}
func deleteRepresentation(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeNoContent(w, s.DeleteRepresentation(r.Context(), actor(r), chi.URLParam(r, "representationID")))
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
		http.Error(w, "internal server error", http.StatusInternalServerError)
	default:
		writeJSON(w, http.StatusOK, value)
	}
}
func pageParams(r *http.Request) (int, int) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	return limit, offset
}
