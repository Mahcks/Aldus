package koreader

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/position"
)

type Credentials struct {
	User string
	Key  string
}

type usernameContextKey struct{}

func Handler(store *position.Store, accounts *auth.Store, fallback Credentials) http.Handler {
	router := chi.NewRouter()
	router.Get("/healthcheck", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"state": "OK"})
	})
	router.Post("/users/create", register(accounts, fallback))
	router.Group(func(router chi.Router) {
		router.Use(authorize(accounts, fallback))
		router.Get("/users/auth", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"authorized": "OK"})
		})
		router.Put("/syncs/progress", putProgress(store))
		router.Get("/syncs/progress/{document}", getProgress(store))
	})
	return router
}

func register(accounts *auth.Store, fallback Credentials) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if !decode(w, r, &request) {
			return
		}
		if _, err := authenticate(r, accounts, fallback, request.Username, request.Password); err != nil {
			if !errors.Is(err, auth.ErrInvalidCredentials) {
				slog.Error("KOReader registration authentication failed", "error", err)
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			writeJSON(w, http.StatusPaymentRequired, map[string]any{"code": 2005, "message": "registration disabled"})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"username": request.Username})
	}
}

func authorize(accounts *auth.Store, fallback Credentials) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			username, err := authenticate(r, accounts, fallback, r.Header.Get("x-auth-user"), r.Header.Get("x-auth-key"))
			if err != nil {
				if !errors.Is(err, auth.ErrInvalidCredentials) {
					slog.Error("KOReader authentication failed", "error", err)
					http.Error(w, "internal server error", http.StatusInternalServerError)
					return
				}
				writeJSON(w, http.StatusUnauthorized, map[string]any{"code": 2001, "message": "unauthorized"})
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), usernameContextKey{}, username)))
		})
	}
}

func authenticate(r *http.Request, accounts *auth.Store, fallback Credentials, username, key string) (string, error) {
	if accounts != nil {
		user, err := accounts.AuthenticateReader(r.Context(), username, key, true)
		if err == nil {
			return user.Username, nil
		}
		if !errors.Is(err, auth.ErrInvalidCredentials) {
			return "", err
		}
	}
	if username == fallback.User && key == fallback.Key && username != "" {
		return username, nil
	}
	return "", auth.ErrInvalidCredentials
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
		username, _ := r.Context().Value(usernameContextKey{}).(string)
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
			if !errors.Is(err, position.ErrNotFound) {
				slog.Error("KOReader progress resolution failed", "document", request.Document, "error", err)
				http.Error(w, "resolve progress", http.StatusInternalServerError)
				return
			}
			slog.Warn("KOReader progress rejected", "diagnosis", "document bytes or XPointer do not match a ready alignment", "document", request.Document, "xpointer", request.Progress)
			writeJSON(w, http.StatusNotFound, map[string]any{"code": 2004, "message": "unknown document or locator"})
			return
		}
		userID, workID, alignmentID, err := store.KOReaderOwner(r.Context(), username, request.Document)
		if err != nil {
			if !errors.Is(err, position.ErrNotFound) {
				slog.Error("KOReader progress authorization failed", "username", username, "document", request.Document, "error", err)
				http.Error(w, "authorize progress", http.StatusInternalServerError)
				return
			}
			slog.Warn("KOReader progress rejected", "diagnosis", "user cannot access the aligned work", "username", username, "document", request.Document)
			writeJSON(w, http.StatusNotFound, map[string]any{"code": 2004, "message": "unknown document or locator"})
			return
		}
		if alignmentID != incoming.AlignmentID {
			slog.Warn("KOReader progress rejected", "diagnosis", "document resolved to a different ready alignment", "document", request.Document, "expected_alignment", alignmentID, "resolved_alignment", incoming.AlignmentID)
			writeJSON(w, http.StatusNotFound, map[string]any{"code": 2004, "message": "unknown document or locator"})
			return
		}
		current, err := store.Progress(r.Context(), userID, workID)
		expected := int64(0)
		if err == nil {
			expected = current.Revision
		} else if !errors.Is(err, position.ErrNotFound) {
			http.Error(w, "get progress", http.StatusInternalServerError)
			return
		}
		device := strings.TrimPrefix(strings.TrimSpace(request.Device+" "+request.DeviceID), " ")
		updated, err := store.UpdateProgress(r.Context(), userID, workID, incoming.AlignmentID, position.Update{
			SegmentID: incoming.SegmentID, Offset: incoming.Offset, ExpectedRevision: expected, SourceDevice: "koreader:" + device,
		})
		if errors.Is(err, position.ErrConflict) {
			writeJSON(w, http.StatusAccepted, map[string]any{"document": request.Document, "conflict": true})
			return
		}
		if err != nil {
			slog.Error("KOReader progress save failed", "username", username, "document", request.Document, "error", err)
			http.Error(w, "save progress", http.StatusInternalServerError)
			return
		}
		slog.Debug("KOReader progress saved", "username", username, "document", request.Document, "segment", updated.SegmentID, "offset", updated.Offset, "revision", updated.Revision)
		writeJSON(w, http.StatusOK, map[string]any{"document": request.Document, "timestamp": updated.UpdatedAt.Unix()})
	}
}

func getProgress(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		username, _ := r.Context().Value(usernameContextKey{}).(string)
		document := chi.URLParam(r, "document")
		userID, workID, _, err := store.KOReaderOwner(r.Context(), username, document)
		if err != nil {
			if !errors.Is(err, position.ErrNotFound) {
				slog.Error("KOReader progress lookup failed", "username", username, "document", document, "error", err)
				http.Error(w, "find progress", http.StatusInternalServerError)
				return
			}
			slog.Debug("KOReader progress unavailable", "diagnosis", "document is not an accessible ready alignment", "username", username, "document", document)
			writeJSON(w, http.StatusOK, map[string]any{})
			return
		}
		progress, err := store.Progress(r.Context(), userID, workID)
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
			slog.Error("KOReader progress conversion failed", "username", username, "document", document, "alignment", progress.AlignmentID, "segment", progress.SegmentID, "offset", progress.Offset, "error", err)
			http.Error(w, "resolve progress", http.StatusInternalServerError)
			return
		}
		slog.Debug("KOReader progress returned", "username", username, "document", document, "segment", progress.SegmentID, "offset", progress.Offset, "revision", progress.Revision, "xpointer", locator.Progress)
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
