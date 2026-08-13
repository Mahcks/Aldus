package v1

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/source"
)

func registerSourceRoutes(r chi.Router, store *source.Store) {
	if store == nil {
		return
	}
	r.Get("/libraries/{libraryID}/sources", listSources(store))
	r.Post("/libraries/{libraryID}/sources", createSource(store))
	r.Get("/libraries/{libraryID}/sources/{sourceID}", getSource(store))
	r.Patch("/libraries/{libraryID}/sources/{sourceID}", updateSource(store))
	r.Delete("/libraries/{libraryID}/sources/{sourceID}", deleteSource(store))
	r.Post("/libraries/{libraryID}/sources/{sourceID}/scans", enqueueSourceScan(store))
	r.Get("/libraries/{libraryID}/sources/{sourceID}/scans", listSourceScans(store))
	r.Get("/libraries/{libraryID}/sources/{sourceID}/entries", listSourceEntries(store))
}
func enqueueSourceScan(s *source.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, err := s.EnqueueScan(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "sourceID"))
		if err != nil {
			writeSourceError(w, err)
			return
		}
		writeJSON(w, http.StatusAccepted, scanDTO(v))
	}
}
func listSourceScans(s *source.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values, err := s.Scans(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "sourceID"))
		if err != nil {
			writeSourceError(w, err)
			return
		}
		out := make([]contracts.SourceScan, len(values))
		for i, v := range values {
			out[i] = scanDTO(v)
		}
		writeJSON(w, http.StatusOK, out)
	}
}
func listSourceEntries(s *source.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values, err := s.Entries(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "sourceID"))
		if err != nil {
			writeSourceError(w, err)
			return
		}
		out := make([]contracts.SourceEntry, len(values))
		for i, v := range values {
			out[i] = entryDTO(v)
		}
		writeJSON(w, http.StatusOK, out)
	}
}
func scanDTO(v source.Scan) contracts.SourceScan {
	return contracts.SourceScan{ID: v.ID, SourceID: v.SourceID, State: v.State, Error: v.Error, FilesVisited: v.FilesVisited, Supported: v.Supported, EPUB: v.EPUB, Audio: v.Audio, New: v.New, Changed: v.Changed, Unchanged: v.Unchanged, Missing: v.Missing, Problems: v.Problems, CreatedAt: v.CreatedAt, StartedAt: v.StartedAt, FinishedAt: v.FinishedAt}
}
func entryDTO(v source.Entry) contracts.SourceEntry {
	var metadata, pathHints map[string]any
	_ = json.Unmarshal(v.Metadata, &metadata)
	_ = json.Unmarshal(v.PathHints, &pathHints)
	return contracts.SourceEntry{ID: v.ID, SourceID: v.SourceID, RelativePath: v.RelativePath, Kind: v.Kind, SHA256: v.SHA256, State: v.State, Error: v.Error, SizeBytes: v.SizeBytes, ModifiedAt: v.ModifiedAt, Metadata: metadata, PathHints: pathHints}
}
func listSources(s *source.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values, err := s.List(r.Context(), actor(r), chi.URLParam(r, "libraryID"))
		if err != nil {
			writeSourceError(w, err)
			return
		}
		out := make([]contracts.LibrarySource, len(values))
		for i, v := range values {
			out[i] = sourceDTO(v)
		}
		writeJSON(w, http.StatusOK, out)
	}
}
func createSource(s *source.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b contracts.CreateLibrarySourceRequest
		if !decode(w, r, &b) {
			return
		}
		v, err := s.Create(r.Context(), actor(r), chi.URLParam(r, "libraryID"), b.Name, b.RootPath)
		if err != nil {
			writeSourceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, sourceDTO(v))
	}
}
func getSource(s *source.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, err := s.Get(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "sourceID"))
		if err != nil {
			writeSourceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, sourceDTO(v))
	}
}
func updateSource(s *source.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b contracts.UpdateLibrarySourceRequest
		if !decode(w, r, &b) {
			return
		}
		err := s.Update(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "sourceID"), b.Name, b.RootPath, b.Enabled)
		if err != nil {
			writeSourceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
func deleteSource(s *source.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := s.Delete(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "sourceID"))
		if err != nil {
			writeSourceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
func sourceDTO(v source.LibrarySource) contracts.LibrarySource {
	return contracts.LibrarySource{ID: v.ID, LibraryID: v.LibraryID, Kind: v.Kind, Name: v.Name, RootPath: v.RootPath, Enabled: v.Enabled, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt}
}
func writeSourceError(w http.ResponseWriter, err error) {
	if errors.Is(err, source.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if errors.Is(err, source.ErrInvalid) {
		http.Error(w, "invalid source", http.StatusBadRequest)
		return
	}
	if errors.Is(err, source.ErrActiveScan) {
		http.Error(w, "scan already active", http.StatusConflict)
		return
	}
	http.Error(w, "internal server error", http.StatusInternalServerError)
}
