package v1

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/alignment"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/catalog"
)

func registerAlignmentJobRoutes(router chi.Router, manager *alignment.Manager, catalogStore *catalog.Store) {
	router.Post("/alignment-jobs", enqueueAlignment(manager))
	router.Get("/alignment-jobs/{jobID}", getAlignmentJob(manager))
	router.Post("/alignment-jobs/{jobID}/cancel", cancelAlignmentJob(manager))
	router.Get("/works/{workID}/alignment-jobs", listAlignmentJobs(manager, catalogStore))
}

func listAlignmentJobs(manager *alignment.Manager, catalogStore *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workID := chi.URLParam(r, "workID")
		if _, err := catalogStore.Work(r.Context(), actor(r), workID); err != nil {
			writeCatalogResult(w, nil, err)
			return
		}
		limit, offset := pageParams(r)
		jobs, err := manager.Jobs(r.Context(), workID, limit, offset)
		if err != nil {
			writeAlignmentJobError(w, err)
			return
		}
		values := make([]contracts.AlignmentJob, len(jobs))
		for i, job := range jobs {
			values[i] = jobDTO(job)
		}
		writeJSON(w, http.StatusOK, values)
	}
}
func enqueueAlignment(m *alignment.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body contracts.CreateAlignmentJobRequest
		if !decode(w, r, &body) {
			return
		}
		job, err := m.Enqueue(r.Context(), actor(r), alignment.Request{EPUBMediaID: body.EPUBMediaID, EPUBSHA256: body.EPUBSHA256, AudioMediaID: body.AudioMediaID, AudioSHA256: body.AudioSHA256})
		if err != nil {
			writeAlignmentJobError(w, err)
			return
		}
		writeJSON(w, http.StatusAccepted, jobDTO(job))
	}
}
func getAlignmentJob(m *alignment.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		job, err := m.Job(r.Context(), actor(r), chi.URLParam(r, "jobID"))
		if err != nil {
			writeAlignmentJobError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, jobDTO(job))
	}
}
func cancelAlignmentJob(m *alignment.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := m.Cancel(r.Context(), actor(r), chi.URLParam(r, "jobID")); err != nil {
			writeAlignmentJobError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
func writeAlignmentJobError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, alignment.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, alignment.ErrInvalid):
		http.Error(w, "invalid alignment job", http.StatusBadRequest)
	default:
		http.Error(w, "internal server error", http.StatusInternalServerError)
	}
}
