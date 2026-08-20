package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/acquisition"
	"github.com/mahcks/aldus/server/internal/api/contracts"
)

func registerTitleRequestRoutes(router chi.Router, store *acquisition.TitleRequestStore) {
	router.Get("/libraries/{libraryID}/title-requests", listTitleRequests(store))
	router.Post("/libraries/{libraryID}/title-requests", createTitleRequest(store))
	router.Get("/libraries/{libraryID}/title-requests/{requestID}", getTitleRequest(store))
	router.Get("/libraries/{libraryID}/title-requests/{requestID}/events", listTitleRequestEvents(store))
	router.Post("/libraries/{libraryID}/title-requests/{requestID}/formats/{format}/approve", approveTitleRequest(store))
	router.Post("/libraries/{libraryID}/title-requests/{requestID}/formats/{format}/deny", denyTitleRequest(store))
	router.Post("/libraries/{libraryID}/title-requests/{requestID}/formats/{format}/cancel", cancelTitleRequest(store))
}

func listTitleRequestEvents(store *acquisition.TitleRequestStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values, err := store.Events(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "requestID"))
		result := make([]contracts.TitleRequestEvent, len(values))
		for i, value := range values {
			result[i] = contracts.TitleRequestEvent{Format: value.Format, EventType: value.EventType, State: value.State, CreatedAt: value.CreatedAt}
		}
		writeAcquisitionResult(w, result, err)
	}
}

func listTitleRequests(store *acquisition.TitleRequestStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values, err := store.List(r.Context(), actor(r), chi.URLParam(r, "libraryID"))
		result := make([]contracts.TitleRequest, len(values))
		for i := range values {
			result[i] = titleRequestDTO(values[i])
		}
		writeAcquisitionResult(w, result, err)
	}
}

func createTitleRequest(store *acquisition.TitleRequestStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.CreateTitleRequest
		if !decode(w, r, &body) {
			return
		}
		value, err := store.Create(r.Context(), actor(r), acquisition.CreateTitleRequest{LibraryID: chi.URLParam(r, "libraryID"), WorkID: body.WorkID, ExternalSource: body.ExternalSource, ExternalID: body.ExternalID, Title: body.Title, Author: body.Author, CoverURL: body.CoverURL, Formats: body.Formats})
		writeAcquisitionResult(w, titleRequestDTO(value), err)
	}
}

func getTitleRequest(store *acquisition.TitleRequestStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := store.Get(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "requestID"))
		writeAcquisitionResult(w, titleRequestDTO(value), err)
	}
}

func approveTitleRequest(store *acquisition.TitleRequestStore) http.HandlerFunc {
	return titleRequestAction(func(r *http.Request) error {
		return store.Approve(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "requestID"), chi.URLParam(r, "format"))
	})
}

func denyTitleRequest(store *acquisition.TitleRequestStore) http.HandlerFunc {
	return titleRequestAction(func(r *http.Request) error {
		return store.Deny(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "requestID"), chi.URLParam(r, "format"))
	})
}

func cancelTitleRequest(store *acquisition.TitleRequestStore) http.HandlerFunc {
	return titleRequestAction(func(r *http.Request) error {
		return store.Cancel(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "requestID"), chi.URLParam(r, "format"))
	})
}

func titleRequestAction(action func(*http.Request) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeAcquisitionAction(w, action(r))
	}
}

func titleRequestDTO(value acquisition.TitleRequest) contracts.TitleRequest {
	formats := make([]contracts.TitleRequestFormat, len(value.Formats))
	for i, format := range value.Formats {
		formats[i] = contracts.TitleRequestFormat{Format: format.Format, State: format.State, Error: format.Error, RetryCount: format.RetryCount, LastSearchedAt: format.LastSearchedAt, NextSearchAt: format.NextSearchAt, UpdatedAt: format.UpdatedAt}
	}
	return contracts.TitleRequest{ID: value.ID, LibraryID: value.LibraryID, RequestedBy: value.RequestedBy, WorkID: value.WorkID, ExternalSource: value.ExternalSource, ExternalID: value.ExternalID, Title: value.Title, Author: value.Author, CoverURL: value.CoverURL, Formats: formats, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
}
