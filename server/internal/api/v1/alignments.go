package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/position"
)

func registerAlignmentRoutes(router chi.Router, store *position.Store, catalogStore *catalog.Store) {
	router.With(requireAlignmentAccess(catalogStore)).Get("/alignments/{alignmentID}", getAlignment(store))
	router.Route("/alignments/{alignmentID}", func(router chi.Router) {
		router.Use(requireAlignmentAccess(catalogStore))
		router.Get("/progress", getProgress(store))
		router.Put("/progress", updateProgress(store))
		router.Post("/resolve/epub", epubToCanonical(store))
		router.Post("/resolve/audio", audioToCanonical(store))
		router.Post("/locators/epub", canonicalToEPUB(store))
		router.Post("/locators/audio", canonicalToAudio(store))
	})
}

func requireAlignmentAccess(store *catalog.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, _ := auth.UserFromContext(r.Context())
			ok, err := store.CanAccessAlignment(r.Context(), user, chi.URLParam(r, "alignmentID"))
			if err != nil {
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			if !ok {
				http.NotFound(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func getAlignment(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		alignment, err := store.Alignment(r.Context(), chi.URLParam(r, "alignmentID"))
		writeResult(w, alignment, err)
	}
}

func getProgress(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		progress, err := store.Progress(r.Context(), chi.URLParam(r, "alignmentID"))
		writeResult(w, progress, err)
	}
}

func updateProgress(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var update position.Update
		if !decode(w, r, &update) {
			return
		}
		progress, err := store.UpdateProgress(r.Context(), chi.URLParam(r, "alignmentID"), update)
		writeResult(w, progress, err)
	}
}

func epubToCanonical(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var locator position.EPUBLocator
		if !decode(w, r, &locator) {
			return
		}
		result, err := store.EPUBToCanonical(r.Context(), chi.URLParam(r, "alignmentID"), locator)
		writeResult(w, result, err)
	}
}

func audioToCanonical(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var locator position.AudioLocator
		if !decode(w, r, &locator) {
			return
		}
		result, err := store.AudioToCanonical(r.Context(), chi.URLParam(r, "alignmentID"), locator)
		writeResult(w, result, err)
	}
}

func canonicalToEPUB(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var canonical position.Canonical
		if !decode(w, r, &canonical) {
			return
		}
		canonical.AlignmentID = chi.URLParam(r, "alignmentID")
		result, err := store.CanonicalToEPUB(r.Context(), canonical)
		writeResult(w, result, err)
	}
}

func canonicalToAudio(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var canonical position.Canonical
		if !decode(w, r, &canonical) {
			return
		}
		canonical.AlignmentID = chi.URLParam(r, "alignmentID")
		result, err := store.CanonicalToAudio(r.Context(), canonical)
		writeResult(w, result, err)
	}
}
