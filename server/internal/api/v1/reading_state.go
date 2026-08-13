package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/position"
)

func registerReadingStateRoutes(router chi.Router, store *position.Store, catalogStore *catalog.Store) {
	router.Get("/works/{workID}/progress", workProgress(store, catalogStore))
	router.Put("/works/{workID}/progress", updateWorkProgress(store, catalogStore))
	router.Get("/representations/{representationID}/state", representationState(store, catalogStore))
	router.Put("/representations/{representationID}/state", updateRepresentationState(store, catalogStore))
}

func workProgress(store *position.Store, catalogStore *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workID := chi.URLParam(r, "workID")
		if _, err := catalogStore.Work(r.Context(), actor(r), workID); err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		value, err := store.Progress(r.Context(), actor(r).ID, workID)
		writeResult(w, value, err)
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
		value, err := store.UpdateProgress(r.Context(), actor(r).ID, workID, request.AlignmentID, request.ProgressUpdate)
		writeResult(w, value, err)
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
		writeResult(w, value, err)
	}
}

func updateRepresentationState(store *position.Store, catalogStore *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "representationID")
		if _, err := catalogStore.Representation(r.Context(), actor(r), id); err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		var update position.RepresentationUpdate
		if !decode(w, r, &update) {
			return
		}
		value, err := store.UpdateRepresentationState(r.Context(), actor(r).ID, id, update)
		writeResult(w, value, err)
	}
}
