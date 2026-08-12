package v1

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/position"
)

func Handler(store *position.Store) http.Handler {
	router := chi.NewRouter()
	router.Get("/health", health)
	router.Get("/alignments/{alignmentID}", getAlignment(store))
	router.Get("/alignments/{alignmentID}/progress", getProgress(store))
	router.Put("/alignments/{alignmentID}/progress", updateProgress(store))
	router.Post("/alignments/{alignmentID}/resolve/epub", epubToCanonical(store))
	router.Post("/alignments/{alignmentID}/resolve/audio", audioToCanonical(store))
	router.Post("/alignments/{alignmentID}/locators/epub", canonicalToEPUB(store))
	router.Post("/alignments/{alignmentID}/locators/audio", canonicalToAudio(store))
	return router
}

func getAlignment(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		alignment, err := store.Alignment(r.Context(), chi.URLParam(r, "alignmentID"))
		writeResult(w, alignment, err)
	}
}

func health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"status":"ok"}`)
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

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return false
	}
	return true
}

func writeResult(w http.ResponseWriter, value any, err error) {
	if errors.Is(err, position.ErrNotFound) {
		http.Error(w, "position not found", http.StatusNotFound)
		return
	}
	if errors.Is(err, position.ErrConflict) {
		writeJSON(w, http.StatusConflict, value)
		return
	}
	if errors.Is(err, position.ErrInvalid) {
		http.Error(w, "invalid position", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
