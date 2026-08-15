package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/ingest"
)

func registerWorkRoutes(router chi.Router, store *catalog.Store, media *ingest.Store) {
	router.Get("/works", browseWorks(store))
	router.Get("/libraries/{libraryID}/works", listWorks(store))
	router.Post("/libraries/{libraryID}/works", createWork(store))
	router.Get("/works/{workID}", getWork(store))
	router.Get("/works/{workID}/covers/search", searchCovers(store, media))
	router.Put("/works/{workID}/cover", selectCover(store))
	router.Post("/works/{workID}/cover", uploadCover(store))
	router.Get("/covers/{coverID}", getCover(store))
	router.Delete("/works/{workID}/cover", restoreCover(store, media))
	router.Patch("/works/{workID}", updateWork(store))
	router.Delete("/works/{workID}", deleteWork(store))
}

func uploadCover(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 10<<20+(1<<20))
		part, _, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "image is required", http.StatusBadRequest)
			return
		}
		defer part.Close()
		writeNoContent(w, s.UploadCover(r.Context(), actor(r), chi.URLParam(r, "workID"), part))
	}
}

func getCover(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, contentType, err := s.Cover(r.Context(), actor(r), chi.URLParam(r, "coverID"))
		if err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "private, max-age=3600")
		w.Write(data)
	}
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
			items[i] = contracts.WorkSummary{ID: value.ID, LibraryID: value.LibraryID, LibraryName: value.LibraryName, LibraryRole: value.LibraryRole, Title: value.Title, Author: value.Author, CoverURL: value.CoverURL, Readable: value.Readable, Listenable: value.Listenable, Synchronized: value.Synchronized, InProgress: value.InProgress, ProgressUpdatedAt: value.ProgressUpdatedAt, CompletionPercent: value.CompletionPercent, ActiveSeconds: value.ActiveSeconds, ReadingSeconds: value.ReadingSeconds, ListeningSeconds: value.ListeningSeconds, LastMode: value.LastMode, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
		}
		writeJSON(w, http.StatusOK, contracts.WorkBrowsePage{Items: items, Offset: offset, HasMore: hasMore})
	}
}

func searchCovers(s *catalog.Store, media *ingest.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workID := chi.URLParam(r, "workID")
		embedded, err := media.Covers(r.Context(), actor(r), workID)
		if err != nil {
			writeMediaError(w, err)
			return
		}
		var values []catalog.CoverCandidate
		if query := r.URL.Query().Get("q"); query != "" {
			values, err = s.SearchCovers(r.Context(), actor(r), workID, query)
			if err != nil {
				writeCatalogResult(w, nil, err)
				return
			}
		}
		items := make([]contracts.CoverCandidate, 0, len(embedded)+len(values))
		for _, value := range embedded {
			items = append(items, contracts.CoverCandidate{Source: "embedded", SourceID: value.MediaID, ImageURL: "/api/media/" + value.MediaID + "/cover", Title: value.Label, Publisher: value.Kind})
		}
		for i, value := range values {
			_ = i
			items = append(items, contracts.CoverCandidate{Source: value.Source, SourceID: value.SourceID, ImageURL: value.ImageURL, Title: value.Title, Author: value.Author, Publisher: value.Publisher, ISBN: value.ISBN, FirstPublishYear: value.FirstPublishYear})
		}
		writeJSON(w, http.StatusOK, items)
	}
}

func selectCover(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.SelectCoverRequest
		if !decode(w, r, &body) {
			return
		}
		writeNoContent(w, s.SelectCover(r.Context(), actor(r), chi.URLParam(r, "workID"), body.Source, body.SourceID))
	}
}

func restoreCover(s *catalog.Store, media *ingest.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workID := chi.URLParam(r, "workID")
		covers, err := media.Covers(r.Context(), actor(r), workID)
		if err == nil && len(covers) > 0 {
			err = s.SelectCover(r.Context(), actor(r), workID, "embedded", covers[0].MediaID)
		} else if err == nil {
			err = s.RestoreCover(r.Context(), actor(r), workID)
		}
		writeNoContent(w, err)
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
