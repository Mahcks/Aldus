package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/position"
)

func registerAlignmentRoutes(router chi.Router, store *position.Store, catalogStore *catalog.Store) {
	router.Group(func(router chi.Router) {
		router.Use(requireAlignmentAccess(catalogStore))
		router.Get("/alignments/{alignmentID}", getAlignment(store))
		router.Get("/alignments/{alignmentID}/progress", getProgress(store))
		router.Put("/alignments/{alignmentID}/progress", updateProgress(store))
		router.Post("/alignments/{alignmentID}/resolve/epub", epubToCanonical(store))
		router.Post("/alignments/{alignmentID}/resolve/audio", audioToCanonical(store))
		router.Post("/alignments/{alignmentID}/locators/epub", canonicalToEPUB(store))
		router.Post("/alignments/{alignmentID}/locators/audio", canonicalToAudio(store))
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
		writePositionResult(w, alignmentDTO(alignment), err)
	}
}

func getProgress(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workID, err := store.WorkForAlignment(r.Context(), chi.URLParam(r, "alignmentID"))
		if err != nil {
			writePositionResult(w, contracts.CanonicalPosition{}, err)
			return
		}
		progress, err := store.Progress(r.Context(), actor(r).ID, workID)
		writePositionResult(w, canonicalDTO(progress), err)
	}
}

func updateProgress(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contracts.ProgressUpdate
		if !decode(w, r, &request) {
			return
		}
		workID, err := store.WorkForAlignment(r.Context(), chi.URLParam(r, "alignmentID"))
		if err != nil {
			writePositionResult(w, contracts.CanonicalPosition{}, err)
			return
		}
		progress, err := store.UpdateProgress(r.Context(), actor(r).ID, workID, chi.URLParam(r, "alignmentID"), position.Update{SegmentID: request.SegmentID, Offset: request.Offset, ExpectedRevision: request.ExpectedRevision, SourceDevice: request.SourceDevice})
		writePositionResult(w, canonicalDTO(progress), err)
	}
}

func epubToCanonical(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contracts.EPUBLocator
		if !decode(w, r, &request) {
			return
		}
		result, err := store.EPUBToCanonical(r.Context(), chi.URLParam(r, "alignmentID"), position.EPUBLocator{Href: request.Href, Locator: request.Locator, Offset: request.Offset})
		writePositionResult(w, canonicalDTO(result), err)
	}
}

func audioToCanonical(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contracts.AudioLocator
		if !decode(w, r, &request) {
			return
		}
		result, err := store.AudioToCanonical(r.Context(), chi.URLParam(r, "alignmentID"), position.AudioLocator{Resource: request.Resource, TimestampMS: request.TimestampMS})
		writePositionResult(w, canonicalDTO(result), err)
	}
}

func canonicalToEPUB(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contracts.CanonicalPosition
		if !decode(w, r, &request) {
			return
		}
		canonical := position.Canonical{AlignmentID: chi.URLParam(r, "alignmentID"), SegmentID: request.SegmentID, Offset: request.Offset}
		result, err := store.CanonicalToEPUB(r.Context(), canonical)
		writePositionResult(w, epubLocatorDTO(result), err)
	}
}

func canonicalToAudio(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contracts.CanonicalPosition
		if !decode(w, r, &request) {
			return
		}
		canonical := position.Canonical{AlignmentID: chi.URLParam(r, "alignmentID"), SegmentID: request.SegmentID, Offset: request.Offset}
		result, err := store.CanonicalToAudio(r.Context(), canonical)
		writePositionResult(w, audioLocatorDTO(result), err)
	}
}
