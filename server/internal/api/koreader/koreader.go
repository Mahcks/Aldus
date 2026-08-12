package koreader

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/position"
)

type Credentials struct {
	User string
	Key  string
}

func Handler(store *position.Store, credentials Credentials) http.Handler {
	router := chi.NewRouter()
	router.Get("/healthcheck", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"state": "OK"})
	})
	router.Post("/users/create", register(credentials))
	router.Group(func(router chi.Router) {
		router.Use(authorize(credentials))
		router.Get("/users/auth", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"authorized": "OK"})
		})
		router.Put("/syncs/progress", putProgress(store))
		router.Get("/syncs/progress/{document}", getProgress(store))
	})
	return router
}

func register(credentials Credentials) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if !decode(w, r, &request) {
			return
		}
		if request.Username != credentials.User || request.Password != credentials.Key {
			writeJSON(w, http.StatusPaymentRequired, map[string]any{"code": 2005, "message": "registration disabled"})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"username": request.Username})
	}
}

func authorize(credentials Credentials) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("x-auth-user") != credentials.User || r.Header.Get("x-auth-key") != credentials.Key {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"code": 2001, "message": "unauthorized"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

type progressRequest struct {
	Document   string  `json:"document"`
	Progress   string  `json:"progress"`
	Percentage float64 `json:"percentage"`
	Device     string  `json:"device"`
	DeviceID   string  `json:"device_id"`
}

func putProgress(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request progressRequest
		if !decode(w, r, &request) {
			return
		}
		if request.Document == "" || request.Progress == "" || request.Device == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"code": 2003, "message": "invalid fields"})
			return
		}
		incoming, err := store.KOReaderToCanonical(r.Context(), position.KOReaderLocator{
			DocumentID: request.Document,
			Progress:   request.Progress,
		})
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]any{"code": 2004, "message": "unknown document or locator"})
			return
		}
		current, err := store.Progress(r.Context(), incoming.AlignmentID)
		expected := int64(0)
		if err == nil {
			expected = current.Revision
			incomingOrdinal, ordinalErr := store.Ordinal(r.Context(), incoming)
			currentOrdinal, currentErr := store.Ordinal(r.Context(), current)
			if ordinalErr != nil || currentErr != nil {
				http.Error(w, "resolve progress", http.StatusInternalServerError)
				return
			}
			if incomingOrdinal < currentOrdinal {
				writeJSON(w, http.StatusAccepted, map[string]any{"document": request.Document, "conflict": true})
				return
			}
			if incoming.SegmentID == current.SegmentID {
				incoming.Offset = current.Offset
			}
		} else if !errors.Is(err, position.ErrNotFound) {
			http.Error(w, "get progress", http.StatusInternalServerError)
			return
		}
		device := strings.TrimPrefix(strings.TrimSpace(request.Device+" "+request.DeviceID), " ")
		updated, err := store.UpdateProgress(r.Context(), incoming.AlignmentID, position.Update{
			SegmentID: incoming.SegmentID, Offset: incoming.Offset, ExpectedRevision: expected, SourceDevice: "koreader:" + device,
		})
		if errors.Is(err, position.ErrConflict) {
			writeJSON(w, http.StatusAccepted, map[string]any{"document": request.Document, "conflict": true})
			return
		}
		if err != nil {
			http.Error(w, "save progress", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"document": request.Document, "timestamp": updated.UpdatedAt.Unix()})
	}
}

func getProgress(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		document := chi.URLParam(r, "document")
		alignmentID, err := store.AlignmentForKOReaderDocument(r.Context(), document)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{})
			return
		}
		progress, err := store.Progress(r.Context(), alignmentID)
		if errors.Is(err, position.ErrNotFound) {
			writeJSON(w, http.StatusOK, map[string]any{})
			return
		}
		if err != nil {
			http.Error(w, "get progress", http.StatusInternalServerError)
			return
		}
		locator, err := store.CanonicalToKOReader(r.Context(), progress)
		if err != nil {
			http.Error(w, "resolve progress", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"document": document, "progress": locator.Progress, "percentage": locator.Percentage,
			"device": progress.SourceDevice, "timestamp": progress.UpdatedAt.Truncate(time.Second).Unix(),
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"code": 2003, "message": "invalid fields"})
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"code": 2003, "message": "invalid fields"})
		return false
	}
	return true
}
