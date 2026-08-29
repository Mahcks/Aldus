package v1

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"time"

	"github.com/mahcks/aldus/server/internal/position"
)

func health(serverVersion string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":         "ok",
			"server_version": serverVersion,
			"api_version":    apiVersion,
		})
	}
}

func ready(serverVersion string, schemaVersion int, check func(context.Context) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if check != nil {
			if err := check(r.Context()); err != nil {
				slog.Warn("readiness check failed", "error", err)
				writeJSON(w, http.StatusServiceUnavailable, map[string]any{
					"status":         "unavailable",
					"server_version": serverVersion,
					"api_version":    apiVersion,
					"schema_version": schemaVersion,
				})
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":         "ready",
			"server_version": serverVersion,
			"api_version":    apiVersion,
			"schema_version": schemaVersion,
		})
	}
}

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
		return false
	}
	controller := http.NewResponseController(w)
	_ = controller.SetReadDeadline(time.Now().Add(30 * time.Second))
	defer controller.SetReadDeadline(time.Time{})
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return false
	}
	return true
}

func pageParams(r *http.Request) (int, int) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	return limit, offset
}

func writePositionResult(w http.ResponseWriter, value any, err error) {
	switch {
	case errors.Is(err, position.ErrNotFound):
		http.Error(w, "position not found", http.StatusNotFound)
	case errors.Is(err, position.ErrConflict):
		writeJSON(w, http.StatusConflict, value)
	case errors.Is(err, position.ErrInvalid):
		http.Error(w, "invalid position", http.StatusBadRequest)
	case err != nil:
		slog.Error("position request failed", "error", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
	default:
		writeJSON(w, http.StatusOK, value)
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
