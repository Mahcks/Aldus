package v1

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/collection"
)

func registerCollectionRoutes(router chi.Router, store *collection.Store) {
	router.Get("/me/collections", listCollections(store))
	router.Post("/me/collections", createCollection(store))
	router.Get("/me/collections/{collectionID}", getCollection(store))
	router.Put("/me/collections/{collectionID}", updateCollection(store))
	router.Delete("/me/collections/{collectionID}", deleteCollection(store))
	router.Post("/me/collections/{collectionID}/works", addCollectionWork(store))
	router.Delete("/me/collections/{collectionID}/works/{workID}", removeCollectionWork(store))
	router.Put("/me/collections/{collectionID}/works/order", reorderCollectionWorks(store))
}

func listCollections(store *collection.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values, err := store.List(r.Context(), actor(r))
		out := make([]contracts.Collection, len(values))
		for i, value := range values {
			out[i] = collectionDTO(value)
		}
		writeCollectionResult(w, http.StatusOK, out, err)
	}
}

func createCollection(store *collection.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.CollectionInput
		if !decode(w, r, &body) {
			return
		}
		value, err := store.Create(r.Context(), actor(r), body.Title, body.Description)
		writeCollectionResult(w, http.StatusCreated, collectionDTO(value), err)
	}
}

func getCollection(store *collection.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := store.Get(r.Context(), actor(r), chi.URLParam(r, "collectionID"))
		writeCollectionResult(w, http.StatusOK, collectionDTO(value), err)
	}
}

func updateCollection(store *collection.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.CollectionInput
		if !decode(w, r, &body) {
			return
		}
		value, err := store.Update(r.Context(), actor(r), chi.URLParam(r, "collectionID"), body.Title, body.Description)
		writeCollectionResult(w, http.StatusOK, collectionDTO(value), err)
	}
}

func deleteCollection(store *collection.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := store.Delete(r.Context(), actor(r), chi.URLParam(r, "collectionID"))
		writeCollectionResult(w, http.StatusNoContent, nil, err)
	}
}

func addCollectionWork(store *collection.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.AddCollectionWorkRequest
		if !decode(w, r, &body) {
			return
		}
		err := store.AddWork(r.Context(), actor(r), chi.URLParam(r, "collectionID"), body.WorkID)
		writeCollectionResult(w, http.StatusNoContent, nil, err)
	}
}

func removeCollectionWork(store *collection.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := store.RemoveWork(r.Context(), actor(r), chi.URLParam(r, "collectionID"), chi.URLParam(r, "workID"))
		writeCollectionResult(w, http.StatusNoContent, nil, err)
	}
}

func reorderCollectionWorks(store *collection.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.ReorderCollectionWorksRequest
		if !decode(w, r, &body) {
			return
		}
		err := store.Reorder(r.Context(), actor(r), chi.URLParam(r, "collectionID"), body.WorkIDs)
		writeCollectionResult(w, http.StatusNoContent, nil, err)
	}
}

func collectionDTO(value collection.Collection) contracts.Collection {
	works := make([]contracts.CollectionWork, len(value.Works))
	for i, work := range value.Works {
		works[i] = contracts.CollectionWork{ID: work.ID, Title: work.Title, Author: work.Author, CoverURL: work.CoverURL, Position: work.Position}
	}
	return contracts.Collection{ID: value.ID, Title: value.Title, Description: value.Description, WorkCount: value.WorkCount, Works: works, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
}

func writeCollectionResult(w http.ResponseWriter, status int, value any, err error) {
	switch {
	case errors.Is(err, collection.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, collection.ErrInvalid):
		http.Error(w, "invalid collection input", http.StatusBadRequest)
	case err != nil:
		slog.Error("collection request failed", "error", err)
		http.Error(w, "collection request failed", http.StatusInternalServerError)
	case status == http.StatusNoContent:
		w.WriteHeader(status)
	default:
		writeJSON(w, status, value)
	}
}
