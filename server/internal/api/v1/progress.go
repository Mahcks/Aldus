package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/position"
)

func registerProgressRoutes(router chi.Router, store *position.Store, catalogStore *catalog.Store) {
	router.Get("/works/{workID}/progress", workProgress(store, catalogStore))
	router.Put("/works/{workID}/progress", updateWorkProgress(store, catalogStore))
	router.Get("/works/{workID}/preference", workPreference(catalogStore))
	router.Put("/works/{workID}/preference", setWorkPreference(catalogStore))
	router.Get("/representations/{representationID}/state", representationState(store, catalogStore))
	router.Put("/representations/{representationID}/state", updateRepresentationState(store, catalogStore))
	router.Post("/works/{workID}/activity", startActivity(store, catalogStore))
	router.Put("/activity/{sessionID}", updateActivity(store))
}

func workPreference(store *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := store.WorkPreference(r.Context(), actor(r), chi.URLParam(r, "workID"))
		writeCatalogResult(w, workPreferenceDTO(value), err)
	}
}

func setWorkPreference(store *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.SetWorkPreferenceRequest
		if !decode(w, r, &body) {
			return
		}
		value, err := store.SetWorkPreference(r.Context(), actor(r), catalog.WorkPreference{WorkID: chi.URLParam(r, "workID"), EPUBMediaID: body.EPUBMediaID, AudioMediaID: body.AudioMediaID, AlignmentID: body.AlignmentID})
		writeCatalogResult(w, workPreferenceDTO(value), err)
	}
}

func workPreferenceDTO(value catalog.WorkPreference) contracts.WorkPreference {
	return contracts.WorkPreference{WorkID: value.WorkID, EPUBMediaID: value.EPUBMediaID, AudioMediaID: value.AudioMediaID, AlignmentID: value.AlignmentID, UpdatedAt: value.UpdatedAt}
}

func startActivity(store *position.Store, catalogStore *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workID := chi.URLParam(r, "workID")
		if _, err := catalogStore.Work(r.Context(), actor(r), workID); err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		var request contracts.StartActivityRequest
		if !decode(w, r, &request) {
			return
		}
		value, err := store.StartActivity(r.Context(), actor(r).ID, workID, request.Mode)
		if err != nil {
			writePositionResult(w, nil, err)
			return
		}
		writeJSON(w, http.StatusCreated, activityDTO(value))
	}
}

func updateActivity(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contracts.UpdateActivityRequest
		if !decode(w, r, &request) {
			return
		}
		value, err := store.UpdateActivity(r.Context(), actor(r).ID, chi.URLParam(r, "sessionID"), request.ActiveSeconds, request.Ended)
		writePositionResult(w, activityDTO(value), err)
	}
}

func workProgress(store *position.Store, catalogStore *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workID := chi.URLParam(r, "workID")
		if _, err := catalogStore.Work(r.Context(), actor(r), workID); err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		value, err := store.Progress(r.Context(), actor(r).ID, workID)
		writePositionResult(w, canonicalDTO(value), err)
	}
}

func updateWorkProgress(store *position.Store, catalogStore *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workID := chi.URLParam(r, "workID")
		if _, err := catalogStore.Work(r.Context(), actor(r), workID); err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		var request contracts.WorkProgressUpdate
		if !decode(w, r, &request) {
			return
		}
		value, err := store.UpdateProgress(r.Context(), actor(r).ID, workID, request.AlignmentID, position.Update{SegmentID: request.SegmentID, Offset: request.Offset, ExpectedRevision: request.ExpectedRevision, SourceDevice: request.SourceDevice})
		writePositionResult(w, canonicalDTO(value), err)
	}
}

func representationState(store *position.Store, catalogStore *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "representationID")
		if _, err := catalogStore.Representation(r.Context(), actor(r), id); err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		value, err := store.RepresentationState(r.Context(), actor(r).ID, id)
		writePositionResult(w, representationStateDTO(value), err)
	}
}

func updateRepresentationState(store *position.Store, catalogStore *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "representationID")
		if _, err := catalogStore.Representation(r.Context(), actor(r), id); err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		var request contracts.RepresentationStateUpdate
		if !decode(w, r, &request) {
			return
		}
		update := position.RepresentationUpdate{EPUBLocator: request.EPUBLocator, AudioTimestampMS: request.AudioTimestampMS, PlaybackSpeed: request.PlaybackSpeed, ReaderLayout: request.ReaderLayout, Zoom: request.Zoom, ReaderTheme: request.ReaderTheme, LineHeight: request.LineHeight, Margin: request.Margin, ExpectedRevision: request.ExpectedRevision}
		value, err := store.UpdateRepresentationState(r.Context(), actor(r).ID, id, update)
		writePositionResult(w, representationStateDTO(value), err)
	}
}
