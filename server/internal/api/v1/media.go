package v1

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/ingest"
)

func registerMediaRoutes(router chi.Router, store *ingest.Store) {
	router.Get("/libraries/{libraryID}/representations/{representationID}/media", listMedia(store))
	router.Post("/libraries/{libraryID}/representations/{representationID}/media", uploadMedia(store))
	router.Get("/media/{mediaID}", downloadMedia(store))
}

func uploadMedia(store *ingest.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, store.MaxBytes()+(1<<20))
		reader, err := r.MultipartReader()
		if err != nil {
			http.Error(w, "invalid multipart upload", http.StatusBadRequest)
			return
		}
		for {
			part, err := reader.NextPart()
			if errors.Is(err, io.EOF) {
				http.Error(w, "file is required", http.StatusBadRequest)
				return
			}
			if err != nil {
				http.Error(w, "invalid multipart upload", http.StatusBadRequest)
				return
			}
			if part.FormName() != "file" {
				part.Close()
				continue
			}
			media, err := store.Upload(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "representationID"), part.FileName(), part)
			part.Close()
			if err == nil {
				writeJSON(w, http.StatusCreated, media)
				return
			}
			writeMediaError(w, err)
			return
		}
	}
}

func listMedia(store *ingest.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset := pageParams(r)
		media, err := store.Media(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "representationID"), limit, offset)
		if err != nil {
			writeMediaError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, media)
	}
}

func downloadMedia(store *ingest.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		file, media, err := store.Open(r.Context(), actor(r), chi.URLParam(r, "mediaID"))
		if err != nil {
			writeMediaError(w, err)
			return
		}
		defer file.Close()
		contentType := "application/octet-stream"
		if media.Kind == "epub" {
			contentType = "application/epub+zip"
		}
		w.Header().Set("Content-Type", contentType)
		if media.OriginalFilename != "" {
			w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": media.OriginalFilename}))
		}
		http.ServeContent(w, r, media.OriginalFilename, time.Time{}, file)
	}
}

func writeMediaError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ingest.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, ingest.ErrTooLarge):
		http.Error(w, "media too large", http.StatusRequestEntityTooLarge)
	case errors.Is(err, ingest.ErrInvalid):
		http.Error(w, "invalid media", http.StatusBadRequest)
	case errors.Is(err, http.ErrBodyReadAfterClose):
		http.Error(w, "upload interrupted", http.StatusBadRequest)
	default:
		http.Error(w, "internal server error", http.StatusInternalServerError)
	}
}
