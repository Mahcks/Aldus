package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/catalog"
)

func registerWorkRoutes(router chi.Router, store *catalog.Store) {
	router.Get("/works", browseWorks(store))
	router.Get("/libraries/{libraryID}/works", listWorks(store))
	router.Post("/libraries/{libraryID}/works", createWork(store))
	router.Get("/works/{workID}", getWork(store))
	router.Patch("/works/{workID}", updateWork(store))
	router.Delete("/works/{workID}", deleteWork(store))
}

func browseWorks(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset := pageParams(r)
		values, hasMore, err := s.BrowseWorks(r.Context(), actor(r), catalog.BrowseOptions{
			LibraryID: r.URL.Query().Get("library_id"), Query: r.URL.Query().Get("q"),
			Sort: r.URL.Query().Get("sort"), Availability: r.URL.Query().Get("availability"),
			Limit: limit, Offset: offset,
		})
		if err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		items := make([]contracts.WorkSummary, len(values))
		for i, value := range values {
			items[i] = contracts.WorkSummary{ID: value.ID, LibraryID: value.LibraryID, LibraryName: value.LibraryName, LibraryRole: value.LibraryRole, Title: value.Title, Author: value.Author, Readable: value.Readable, Listenable: value.Listenable, Synchronized: value.Synchronized, InProgress: value.InProgress, ProgressUpdatedAt: value.ProgressUpdatedAt, CompletionPercent: value.CompletionPercent, ActiveSeconds: value.ActiveSeconds, ReadingSeconds: value.ReadingSeconds, ListeningSeconds: value.ListeningSeconds, LastMode: value.LastMode, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
		}
		writeJSON(w, http.StatusOK, contracts.WorkBrowsePage{Items: items, Offset: offset, HasMore: hasMore})
	}
}

func listWorks(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset := pageParams(r)
		v, e := s.Works(r.Context(), actor(r), chi.URLParam(r, "libraryID"), limit, offset)
		writeCatalogResult(w, workDTOs(v), e)
	}
}
func createWork(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b contracts.CreateWorkRequest
		if !decode(w, r, &b) {
			return
		}
		v, e := s.CreateWork(r.Context(), actor(r), chi.URLParam(r, "libraryID"), b.Title, b.Author)
		if e == nil {
			writeJSON(w, http.StatusCreated, workDTO(v))
			return
		}
		writeCatalogResult(w, workDTO(v), e)
	}
}
func getWork(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, e := s.WorkDetail(r.Context(), actor(r), chi.URLParam(r, "workID"))
		writeCatalogResult(w, workDetailDTO(v), e)
	}
}
func updateWork(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b contracts.UpdateWorkRequest
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
