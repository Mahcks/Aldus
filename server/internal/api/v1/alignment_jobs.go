package v1

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/alignment"
)

func registerAlignmentJobRoutes(router chi.Router, manager *alignment.Manager) {
	router.Post("/alignment-jobs", enqueueAlignment(manager))
	router.Get("/alignment-jobs/{jobID}", getAlignmentJob(manager))
	router.Post("/alignment-jobs/{jobID}/cancel", cancelAlignmentJob(manager))
}
func enqueueAlignment(m *alignment.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body alignment.Request
		if !decode(w, r, &body) {
			return
		}
		job, err := m.Enqueue(r.Context(), actor(r), body)
		if err != nil {
			writeAlignmentJobError(w, err)
			return
		}
		writeJSON(w, http.StatusAccepted, job)
	}
}
func getAlignmentJob(m *alignment.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		job, err := m.Job(r.Context(), actor(r), chi.URLParam(r, "jobID"))
		if err != nil {
			writeAlignmentJobError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, job)
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
