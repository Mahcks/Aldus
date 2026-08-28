package v1

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/genretag"
)

func registerGenreTagRoutes(router chi.Router, store *genretag.Store) {
	if store == nil {
		return
	}
	router.Get("/genre-tags", listGenreTags(store))
	router.Get("/genre-tags/unmatched-subjects", listUnmatchedGenreSubjects(store))
	router.Post("/genre-tags", createGenreTag(store))
	router.Patch("/genre-tags/{tagID}", updateGenreTag(store))
	router.Delete("/genre-tags/{tagID}", deleteGenreTag(store))
	router.Put("/works/{workID}/genre-tags", setWorkGenreTags(store))
	router.Delete("/works/{workID}/genre-tags", resetWorkGenreTags(store))
}

func setWorkGenreTags(store *genretag.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.SetWorkGenreTagsRequest
		if !decode(w, r, &body) {
			return
		}
		if err := store.SetWork(r.Context(), actor(r), chi.URLParam(r, "workID"), body.GenreTagIDs); err != nil {
			writeGenreTagError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func resetWorkGenreTags(store *genretag.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := store.ResetWork(r.Context(), actor(r), chi.URLParam(r, "workID")); err != nil {
			writeGenreTagError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func listUnmatchedGenreSubjects(store *genretag.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset := pageParams(r)
		if offset < 0 {
			offset = 0
		}
		values, hasMore, err := store.Unmatched(r.Context(), actor(r), limit, offset)
		if err != nil {
			writeGenreTagError(w, err)
			return
		}
		items := make([]contracts.UnmatchedGenreSubject, len(values))
		for i, value := range values {
			items[i] = contracts.UnmatchedGenreSubject{Subject: value.Subject, WorkCount: value.WorkCount}
		}
		writeJSON(w, http.StatusOK, contracts.UnmatchedGenreSubjectPage{Items: items, Offset: offset, HasMore: hasMore})
	}
}

func listGenreTags(store *genretag.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values, err := store.List(r.Context())
		if err != nil {
			writeGenreTagError(w, err)
			return
		}
		includeKeywords := actor(r).Admin
		out := make([]contracts.GenreTag, len(values))
		for i, value := range values {
			out[i] = genreTagDTO(value, includeKeywords)
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func createGenreTag(store *genretag.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.CreateGenreTagRequest
		if !decode(w, r, &body) {
			return
		}
		value, err := store.Create(r.Context(), actor(r), body.Label, body.Icon, body.Keywords)
		if err != nil {
			writeGenreTagError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, genreTagDTO(value, true))
	}
}

func updateGenreTag(store *genretag.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.UpdateGenreTagRequest
		if !decode(w, r, &body) {
			return
		}
		value, err := store.Update(r.Context(), actor(r), chi.URLParam(r, "tagID"), body.Label, body.Icon, body.Keywords)
		if err != nil {
			writeGenreTagError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, genreTagDTO(value, true))
	}
}

func deleteGenreTag(store *genretag.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := store.Delete(r.Context(), actor(r), chi.URLParam(r, "tagID")); err != nil {
			writeGenreTagError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func genreTagDTO(value genretag.Tag, includeKeywords bool) contracts.GenreTag {
	out := contracts.GenreTag{ID: value.ID, Label: value.Label, Icon: value.Icon}
	if includeKeywords {
		out.Keywords = value.Keywords
	}
	return out
}

func writeGenreTagError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, genretag.ErrForbidden):
		http.Error(w, "forbidden", http.StatusForbidden)
	case errors.Is(err, genretag.ErrInvalid):
		http.Error(w, "invalid genre tag", http.StatusBadRequest)
	case errors.Is(err, genretag.ErrNotFound):
		http.Error(w, "genre tag not found", http.StatusNotFound)
	case errors.Is(err, genretag.ErrWorkNotFound):
		http.Error(w, "work not found", http.StatusNotFound)
	case errors.Is(err, genretag.ErrConflict):
		http.Error(w, "a genre tag with that label already exists", http.StatusConflict)
	default:
		slog.Error("genre tag request failed", "error", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
	}
}
