package v1

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/genretag"
	"github.com/mahcks/aldus/server/internal/ingest"
)

func registerWorkRoutes(router chi.Router, store *catalog.Store, media *ingest.Store, tags *genretag.Store) {
	router.Get("/works", browseWorks(store))
	router.Get("/catalog/{kind}", catalogGroups(store))
	router.Get("/libraries/{libraryID}/works", listWorks(store))
	router.Post("/libraries/{libraryID}/works", createWork(store))
	router.Get("/works/{workID}", getWork(store, tags))
	router.Post("/works/{workID}/metadata/refresh", refreshWorkMetadata(store, tags))
	router.Put("/works/{workID}/status", setWorkStatus(store))
	router.Get("/works/{workID}/covers/search", searchCovers(store, media))
	router.Get("/works/{workID}/covers", listCovers(store, media))
	router.Put("/works/{workID}/cover", selectCover(store))
	router.Post("/works/{workID}/cover", uploadCover(store))
	router.Patch("/works/{workID}/cover/settings", updateCoverSettings(store))
	router.Delete("/works/{workID}/covers/{coverID}", deleteCover(store))
	router.Get("/covers/{coverID}", getCover(store))
	router.Delete("/works/{workID}/cover", restoreCover(store))
	router.Patch("/works/{workID}", updateWork(store))
	router.Delete("/works/{workID}", deleteWork(store))
}

func refreshWorkMetadata(s *catalog.Store, tags *genretag.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := s.RefreshMetadata(r.Context(), actor(r), chi.URLParam(r, "workID"))
		writeTaggedWorkDetail(w, r, tags, value, err)
	}
}

func listCovers(s *catalog.Store, media *ingest.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workID := chi.URLParam(r, "workID")
		stored, err := s.Covers(r.Context(), actor(r), workID)
		if err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		embedded, err := media.Covers(r.Context(), actor(r), workID)
		if err != nil {
			writeMediaError(w, err)
			return
		}
		items := make([]contracts.CoverAsset, 0, len(stored)+len(embedded))
		seen := make(map[string]bool)
		for _, value := range stored {
			seen[value.Source+"\x00"+value.SourceID] = true
			items = append(items, contracts.CoverAsset{ID: value.ID, Source: value.Source, SourceID: value.SourceID, ImageURL: value.ImageURL, Label: value.Label, Selected: value.Selected, CreatedAt: value.CreatedAt})
		}
		for _, value := range embedded {
			if seen["embedded\x00"+value.MediaID] {
				continue
			}
			items = append(items, contracts.CoverAsset{Source: "embedded", SourceID: value.MediaID, ImageURL: "/api/media/" + value.MediaID + "/cover", Label: value.Label})
		}
		writeJSON(w, http.StatusOK, items)
	}
}

func updateCoverSettings(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.UpdateCoverSettingsRequest
		if !decode(w, r, &body) {
			return
		}
		writeNoContent(w, s.UpdateCoverSettings(r.Context(), actor(r), chi.URLParam(r, "workID"), catalog.CoverSettings{Fit: body.Fit, FocalX: body.FocalX, FocalY: body.FocalY, Style: body.Style, Tone: body.Tone, Layout: body.Layout}))
	}
}

func deleteCover(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeNoContent(w, s.DeleteCover(r.Context(), actor(r), chi.URLParam(r, "workID"), chi.URLParam(r, "coverID")))
	}
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
			Series: r.URL.Query().Get("series"), Narrator: r.URL.Query().Get("narrator"), LibraryID: r.URL.Query().Get("library_id"), Query: r.URL.Query().Get("q"),
			Sort: r.URL.Query().Get("sort"), Availability: r.URL.Query().Get("availability"), Status: r.URL.Query().Get("status"),
			Limit: limit, Offset: offset,
		})
		if err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		items := make([]contracts.WorkSummary, len(values))
		for i, value := range values {
			items[i] = contracts.WorkSummary{Series: value.Series, SeriesPosition: catalog.SeriesPosition(value.SeriesOrder), ID: value.ID, LibraryID: value.LibraryID, LibraryName: value.LibraryName, Title: value.Title, Author: value.Author, CoverURL: value.CoverURL, CoverFit: value.CoverFit, CoverFocalX: value.CoverFocalX, CoverFocalY: value.CoverFocalY, GeneratedCoverStyle: value.GeneratedCoverStyle, GeneratedCoverTone: value.GeneratedCoverTone, GeneratedCoverLayout: value.GeneratedCoverLayout, Readable: value.Readable, Listenable: value.Listenable, Synchronized: value.Synchronized, InProgress: value.InProgress, ProgressUpdatedAt: value.ProgressUpdatedAt, CompletionPercent: value.CompletionPercent, ActiveSeconds: value.ActiveSeconds, ReadingSeconds: value.ReadingSeconds, ListeningSeconds: value.ListeningSeconds, LastMode: value.LastMode, ReadingStatus: value.ReadingStatus, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
		}
		writeJSON(w, http.StatusOK, contracts.WorkBrowsePage{Items: items, Offset: offset, HasMore: hasMore})
	}
}

func setWorkStatus(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.SetWorkStatusRequest
		if !decode(w, r, &body) {
			return
		}
		writeNoContent(w, s.SetWorkStatus(r.Context(), actor(r), chi.URLParam(r, "workID"), body.Status))
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

func restoreCover(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeNoContent(w, s.RestoreCover(r.Context(), actor(r), chi.URLParam(r, "workID")))
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
func getWork(s *catalog.Store, tags *genretag.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, e := s.WorkDetail(r.Context(), actor(r), chi.URLParam(r, "workID"))
		writeTaggedWorkDetail(w, r, tags, v, e)
	}
}

func writeTaggedWorkDetail(w http.ResponseWriter, r *http.Request, tags *genretag.Store, value catalog.WorkDetail, err error) {
	if err != nil {
		writeCatalogResult(w, nil, err)
		return
	}
	out := workDetailDTO(value)
	if tags != nil {
		matched, manual, matchErr := tags.ForWork(r.Context(), value.ID, value.SubjectValues)
		if matchErr != nil {
			slog.Error("match work genre tags", "error", matchErr, "work_id", value.ID)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		out.GenreTags = make([]contracts.GenreTag, len(matched))
		for i, tag := range matched {
			out.GenreTags[i] = genreTagDTO(tag, false)
		}
		out.GenreTagsManual = manual
	}
	writeJSON(w, http.StatusOK, out)
}
func updateWork(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b contracts.UpdateWorkRequest
		if !decode(w, r, &b) {
			return
		}
		workID := chi.URLParam(r, "workID")
		current, err := s.WorkDetail(r.Context(), actor(r), workID)
		if err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		update := catalog.WorkUpdate{
			Series: b.Series, SeriesPosition: b.SeriesPosition,
			Title: b.Title, Author: b.Author, Description: current.Description, ISBN: current.ISBN,
			FirstPublishYear: current.FirstPublishYear, Publisher: current.Publisher, Language: current.Language, Subjects: current.SubjectValues,
		}
		if b.Description != nil {
			update.Description = *b.Description
		}
		if b.ISBN != nil {
			update.ISBN = *b.ISBN
		}
		if b.FirstPublishYear != nil {
			update.FirstPublishYear = *b.FirstPublishYear
		}
		if b.Publisher != nil {
			update.Publisher = *b.Publisher
		}
		if b.Language != nil {
			update.Language = *b.Language
		}
		if b.Subjects != nil {
			update.Subjects = *b.Subjects
		}
		writeNoContent(w, s.UpdateWork(r.Context(), actor(r), workID, update))
	}
}
func deleteWork(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeNoContent(w, s.DeleteWork(r.Context(), actor(r), chi.URLParam(r, "workID")))
	}
}

func catalogGroups(s *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset := pageParams(r)
		values, more, err := s.CatalogGroups(r.Context(), actor(r), chi.URLParam(r, "kind"), r.URL.Query().Get("q"), limit, offset)
		if err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		items := make([]contracts.CatalogGroup, len(values))
		for i, v := range values {
			items[i] = contracts.CatalogGroup{Name: v.Name, LibraryID: v.LibraryID, LibraryName: v.LibraryName, WorkCount: v.WorkCount}
		}
		writeJSON(w, http.StatusOK, contracts.CatalogGroupPage{Items: items, Offset: offset, HasMore: more})
	}
}
