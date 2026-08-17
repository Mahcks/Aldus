package v1

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/acquisition"
	"github.com/mahcks/aldus/server/internal/api/contracts"
)

func registerAcquisitionRoutes(router chi.Router, store *acquisition.Store) {
	router.Get("/acquisition-settings", getAcquisitionSettings(store))
	router.Put("/acquisition-settings", updateAcquisitionSettings(store))
	router.Post("/acquisition-settings/test", testAcquisitionSettings(store))
	router.Get("/acquisition-capabilities", acquisitionCapabilities(store))
	router.Get("/me/acquisition-tracker", acquisitionTracker(store))
	router.Post("/me/acquisition-tracker/seen", markAcquisitionTrackerSeen(store))
	router.Get("/libraries/{libraryID}/acquisition-requests", listAcquisitionRequests(store))
	router.Post("/libraries/{libraryID}/acquisition-discoveries", createAcquisitionDiscovery(store))
	router.Post("/libraries/{libraryID}/acquisition-discoveries/{discoveryID}/select", selectAcquisitionDiscovery(store))
	router.Post("/libraries/{libraryID}/acquisition-discoveries/{discoveryID}/select-pair", selectAcquisitionPair(store))
	router.Post("/libraries/{libraryID}/acquisition-requests", createAcquisitionRequest(store))
	router.Get("/libraries/{libraryID}/acquisition-requests/{requestID}/search", searchAcquisitionRequest(store))
	router.Post("/libraries/{libraryID}/acquisition-requests/{requestID}/select", selectAcquisitionResult(store))
}

func selectAcquisitionPair(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.SelectAcquisitionPairRequest
		if !decode(w, r, &body) {
			return
		}
		value, err := store.SelectPairDiscovery(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "discoveryID"), body.ResultIDs)
		writeAcquisitionResult(w, contracts.AcquisitionPair{ID: value.ID, Requests: acquisitionRequestDTOs(value.Requests)}, err)
	}
}

func createAcquisitionDiscovery(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.CreateAcquisitionRequest
		if !decode(w, r, &body) {
			return
		}
		value, err := store.Discover(r.Context(), actor(r), chi.URLParam(r, "libraryID"), body.SourceID, body.Query)
		results := make([]contracts.AcquisitionResult, len(value.Results))
		for i, result := range value.Results {
			results[i] = acquisitionResultDTO(result)
		}
		writeAcquisitionResult(w, contracts.AcquisitionDiscovery{ID: value.ID, Results: results}, err)
	}
}

func selectAcquisitionDiscovery(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.SelectAcquisitionRequest
		if !decode(w, r, &body) {
			return
		}
		value, err := store.SelectDiscovery(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "discoveryID"), body.ResultID)
		writeAcquisitionResult(w, acquisitionRequestDTO(value), err)
	}
}

func acquisitionCapabilities(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		enabled, err := store.Available(r.Context())
		var destinations []acquisition.Destination
		if err == nil && enabled {
			destinations, err = store.Destinations(r.Context(), actor(r))
		}
		values := make([]contracts.AcquisitionDestination, len(destinations))
		for index, value := range destinations {
			values[index] = contracts.AcquisitionDestination{LibraryID: value.LibraryID, LibraryName: value.LibraryName, SourceID: value.SourceID, SourceName: value.SourceName}
		}
		writeAcquisitionResult(w, contracts.AcquisitionCapabilities{Enabled: enabled, Destinations: values}, err)
	}
}

func acquisitionTracker(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := store.Tracker(r.Context(), actor(r))
		writeAcquisitionResult(w, contracts.AcquisitionTracker{Requests: acquisitionRequestDTOs(value.Requests), UnreadCount: value.UnreadCount}, err)
	}
}

func markAcquisitionTrackerSeen(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := store.MarkTrackerSeen(r.Context(), actor(r)); err != nil {
			writeAcquisitionResult(w, nil, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func testAcquisitionSettings(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := store.TestConnections(r.Context(), actor(r))
		writeAcquisitionResult(w, contracts.AcquisitionConnectionStatus{ProwlarrOK: value.ProwlarrOK, IndexerCount: value.IndexerCount, ProwlarrError: value.ProwlarrError, QBitTorrentOK: value.QBitTorrentOK, QBitTorrentError: value.QBitTorrentError}, err)
	}
}

func getAcquisitionSettings(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := store.Settings(r.Context(), actor(r))
		writeAcquisitionResult(w, acquisitionSettingsDTO(value), err)
	}
}

func updateAcquisitionSettings(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.UpdateAcquisitionSettingsRequest
		if !decode(w, r, &body) {
			return
		}
		value, err := store.UpdateSettings(r.Context(), actor(r), acquisition.SettingsUpdate{IndexerKind: body.IndexerKind, IndexerURL: body.IndexerURL, IndexerAPIKey: body.IndexerAPIKey, QBitURL: body.QBitTorrentURL, QBitUsername: body.QBitTorrentUsername, QBitPassword: body.QBitTorrentPassword, QBitCategory: body.QBitTorrentCategory, QBitDownloadRoot: body.QBitTorrentDownloadRoot})
		writeAcquisitionResult(w, acquisitionSettingsDTO(value), err)
	}
}

func acquisitionSettingsDTO(value acquisition.Settings) contracts.AcquisitionSettings {
	return contracts.AcquisitionSettings{IndexerKind: value.IndexerKind, IndexerURL: value.IndexerURL, HasIndexerAPIKey: value.HasIndexerAPIKey, QBitTorrentURL: value.QBitURL, QBitTorrentUsername: value.QBitUsername, HasQBitTorrentPassword: value.HasQBitPassword, QBitTorrentCategory: value.QBitCategory, QBitTorrentDownloadRoot: value.QBitDownloadRoot}
}

func listAcquisitionRequests(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values, err := store.List(r.Context(), actor(r), chi.URLParam(r, "libraryID"))
		writeAcquisitionResult(w, acquisitionRequestDTOs(values), err)
	}
}

func createAcquisitionRequest(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.CreateAcquisitionRequest
		if !decode(w, r, &body) {
			return
		}
		value, err := store.Create(r.Context(), actor(r), chi.URLParam(r, "libraryID"), body.SourceID, body.Query)
		if err == nil {
			writeJSON(w, http.StatusCreated, acquisitionRequestDTO(value))
			return
		}
		writeAcquisitionResult(w, nil, err)
	}
}

func searchAcquisitionRequest(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values, err := store.Search(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "requestID"))
		results := make([]contracts.AcquisitionResult, len(values))
		for i, value := range values {
			results[i] = acquisitionResultDTO(value)
		}
		writeAcquisitionResult(w, results, err)
	}
}

func selectAcquisitionResult(store *acquisition.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.SelectAcquisitionRequest
		if !decode(w, r, &body) {
			return
		}
		value, err := store.Select(r.Context(), actor(r), chi.URLParam(r, "libraryID"), chi.URLParam(r, "requestID"), body.ResultID)
		writeAcquisitionResult(w, acquisitionRequestDTO(value), err)
	}
}

func acquisitionRequestDTO(value acquisition.Request) contracts.AcquisitionRequest {
	return contracts.AcquisitionRequest{ID: value.ID, LibraryID: value.LibraryID, RequestedBy: value.RequestedBy, SourceID: value.SourceID, Query: value.Query, Status: value.Status, DownloadState: value.DownloadState, DownloadError: value.DownloadError, FulfillmentState: value.FulfillmentState, ScanID: value.ScanID, ProposalID: value.ProposalID, WorkID: value.WorkID, PairID: value.PairID, SelectedTitle: value.SelectedTitle, SelectedSource: value.SelectedSource, SelectedSize: value.SelectedSize, SelectedPublishedAt: value.SelectedPublished, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
}

func acquisitionRequestDTOs(values []acquisition.Request) []contracts.AcquisitionRequest {
	result := make([]contracts.AcquisitionRequest, len(values))
	for i, value := range values {
		result[i] = acquisitionRequestDTO(value)
	}
	return result
}

func acquisitionResultDTO(value acquisition.SearchResult) contracts.AcquisitionResult {
	return contracts.AcquisitionResult{ID: value.ID, Title: value.Title, Source: value.Source, CanonicalTitle: value.CanonicalTitle, Author: value.Author, Language: value.Language, Format: value.Format, Kind: value.Kind, Edition: value.Edition, Narrator: value.Narrator, GroupKey: value.GroupKey, Match: value.Match, Size: value.Size, Published: value.Published, Relevance: value.Relevance, Year: value.Year, ISBN: value.ISBN, CoverURL: value.CoverURL, Abridged: value.Abridged, MatchConfidence: value.MatchConfidence, MatchReasons: value.MatchReasons, LikelyPairIDs: value.LikelyPairIDs}
}

func writeAcquisitionResult(w http.ResponseWriter, value any, err error) {
	switch {
	case errors.Is(err, acquisition.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, acquisition.ErrInvalid):
		http.Error(w, "invalid acquisition input", http.StatusBadRequest)
	case errors.Is(err, acquisition.ErrForbidden):
		http.Error(w, "administrator access required", http.StatusForbidden)
	case errors.Is(err, acquisition.ErrUnavailable):
		http.Error(w, "acquisition is not configured", http.StatusServiceUnavailable)
	case err != nil:
		slog.Error("acquisition request failed", "error", err)
		http.Error(w, "acquisition request failed", http.StatusBadGateway)
	default:
		writeJSON(w, http.StatusOK, value)
	}
}
