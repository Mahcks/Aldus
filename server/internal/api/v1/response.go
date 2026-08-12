package v1

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/mahcks/aldus/server/internal/position"
)

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
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

func writeResult(w http.ResponseWriter, value any, err error) {
	switch {
	case errors.Is(err, position.ErrNotFound):
		http.Error(w, "position not found", http.StatusNotFound)
	case errors.Is(err, position.ErrConflict):
		writeJSON(w, http.StatusConflict, value)
	case errors.Is(err, position.ErrInvalid):
		http.Error(w, "invalid position", http.StatusBadRequest)
	case err != nil:
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
