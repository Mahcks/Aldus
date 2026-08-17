package v1

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/diagnostics"
)

func registerDiagnosticRoutes(router chi.Router, store *diagnostics.Store) {
	router.Get("/system/diagnostics", systemDiagnostics(store))
}

func systemDiagnostics(store *diagnostics.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value, err := store.Report(r.Context(), actor(r))
		if errors.Is(err, diagnostics.ErrForbidden) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, contracts.SystemDiagnostics{
			Version: value.Version, Environment: value.Environment, SchemaVersion: value.SchemaVersion,
			DatabaseStatus: value.DatabaseStatus, StorageStatus: value.StorageStatus,
			SourceRootsConfigured: value.SourceRootsConfigured, SourceRootsReachable: value.SourceRootsReachable,
			PendingSourceScans: value.PendingSourceScans, FailedSourceScans: value.FailedSourceScans,
			PendingAlignmentJobs: value.PendingAlignmentJobs, FailedAlignmentJobs: value.FailedAlignmentJobs,
			AcquisitionConfigured: value.AcquisitionConfigured,
		})
	}
}
