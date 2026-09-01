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
	Document   string          `json:"document"`
	Metadata   json.RawMessage `json:"metadata,omitempty"`
	Progress   string          `json:"progress"`
	Percentage float64         `json:"percentage"`
	Device     string          `json:"device"`
	DeviceID   string          `json:"device_id"`
}

func putProgress(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		username, _ := r.Context().Value(usernameContextKey{}).(string)
		var request progressRequest
		if !decode(w, r, &request) {
			return
		}
		if request.Document == "" || request.Progress == "" || request.Device == "" || request.DeviceID == "" || request.Percentage < 0 || request.Percentage > 1 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"code": 2003, "message": "invalid fields"})
			return
		}
		document, err := store.KOReaderDocument(r.Context(), username, request.Document)
		if err != nil {
			if !errors.Is(err, position.ErrNotFound) && !errors.Is(err, position.ErrAmbiguous) {
				slog.Error("KOReader document authorization failed", "username", username, "document", request.Document, "error", err)
				http.Error(w, "authorize progress", http.StatusInternalServerError)
				return
			}
			diagnosis := "unknown or inaccessible EPUB"
			if errors.Is(err, position.ErrAmbiguous) {
				diagnosis = "KOReader partial-MD5 collision across accessible EPUBs"
			}
			slog.Warn("KOReader progress rejected", "diagnosis", diagnosis, "username", username, "document", request.Document)
			writeJSON(w, http.StatusNotFound, map[string]any{"code": 2004, "message": "unknown document"})
			return
		}
		native, err := store.SaveKOReaderProgress(r.Context(), document.UserID, document.MediaID, position.KOReaderProgress{
			Progress: request.Progress, Percentage: request.Percentage, Device: request.Device, DeviceID: request.DeviceID,
		})
		if err != nil {
			if errors.Is(err, position.ErrInvalid) {
				writeJSON(w, http.StatusBadRequest, map[string]any{"code": 2003, "message": "invalid fields"})
				return
			}
			slog.Error("KOReader native progress save failed", "username", username, "document", request.Document, "error", err)
			http.Error(w, "save progress", http.StatusInternalServerError)
			return
		}
		if document.AlignmentID != "" {
			incoming, resolveErr := store.KOReaderToCanonicalForAlignment(r.Context(), position.KOReaderLocator{DocumentID: request.Document, Progress: request.Progress}, document.AlignmentID)
			if resolveErr == nil {
				updated, updateErr := updateCanonical(r.Context(), store, document, incoming, request.Device, request.DeviceID)
				if errors.Is(updateErr, position.ErrConflict) {
					slog.Debug("KOReader canonical progress deferred after concurrent updates", "username", username, "document", request.Document)
				} else if updateErr != nil {
					slog.Error("KOReader canonical progress save failed", "username", username, "document", request.Document, "error", updateErr)
					http.Error(w, "save progress", http.StatusInternalServerError)
					return
				} else {
					native.UpdatedAt = updated.UpdatedAt
				}
			} else if !errors.Is(resolveErr, position.ErrNotFound) {
				slog.Error("KOReader progress resolution failed", "document", request.Document, "error", resolveErr)
				http.Error(w, "resolve progress", http.StatusInternalServerError)
				return
			} else {
				slog.Debug("KOReader progress retained without canonical mapping", "username", username, "document", request.Document, "xpointer", request.Progress)
			}
		}
		slog.Debug("KOReader progress saved", "username", username, "document", request.Document)
		writeJSON(w, http.StatusOK, map[string]any{"document": request.Document, "timestamp": native.UpdatedAt.Unix()})
	}
}

func updateCanonical(ctx context.Context, store *position.Store, document position.KOReaderDocument, incoming position.Canonical, device, deviceID string) (position.Canonical, error) {
	for range 3 {
		expected := int64(0)
		current, err := store.Progress(ctx, document.UserID, document.WorkID)
		if err == nil {
			expected = current.Revision
		} else if !errors.Is(err, position.ErrNotFound) {
			return position.Canonical{}, err
		}
		updated, err := store.UpdateProgress(ctx, document.UserID, document.WorkID, document.AlignmentID, position.Update{
			SegmentID: incoming.SegmentID, Offset: incoming.Offset, ExpectedRevision: expected,
			SourceDevice: "koreader:" + strings.TrimSpace(device), SourceDeviceID: strings.TrimSpace(deviceID),
		})
		if !errors.Is(err, position.ErrConflict) {
			return updated, err
		}
	}
	return position.Canonical{}, position.ErrConflict
}

func getProgress(store *position.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		username, _ := r.Context().Value(usernameContextKey{}).(string)
		document := chi.URLParam(r, "document")
		matched, err := store.KOReaderDocument(r.Context(), username, document)
		if err != nil {
			if !errors.Is(err, position.ErrNotFound) && !errors.Is(err, position.ErrAmbiguous) {
				slog.Error("KOReader progress lookup failed", "username", username, "document", document, "error", err)
				http.Error(w, "find progress", http.StatusInternalServerError)
				return
			}
			slog.Debug("KOReader progress unavailable", "diagnosis", "document is unknown, inaccessible, or ambiguous", "username", username, "document", document)
			writeJSON(w, http.StatusOK, map[string]any{})
			return
		}
		native, nativeErr := store.KOReaderProgress(r.Context(), matched.UserID, matched.MediaID)
		if nativeErr != nil && !errors.Is(nativeErr, position.ErrNotFound) {
			http.Error(w, "get progress", http.StatusInternalServerError)
			return
		}
		canonical, canonicalErr := store.Progress(r.Context(), matched.UserID, matched.WorkID)
		if canonicalErr != nil && !errors.Is(canonicalErr, position.ErrNotFound) {
			http.Error(w, "get progress", http.StatusInternalServerError)
			return
		}
		canonicalRepeatsNative := nativeErr == nil && strings.HasPrefix(canonical.SourceDevice, "koreader:") && canonical.SourceDeviceID == native.DeviceID
		if canonicalErr == nil && matched.AlignmentID == canonical.AlignmentID && !canonicalRepeatsNative && (nativeErr != nil || !native.UpdatedAt.After(canonical.UpdatedAt)) {
			locator, convertErr := store.CanonicalToKOReader(r.Context(), canonical)
			if convertErr == nil {
				device, deviceID := canonical.SourceDevice, canonical.SourceDeviceID
				if strings.HasPrefix(device, "koreader:") {
					device = strings.TrimPrefix(device, "koreader:")
					if deviceID == "" && nativeErr == nil {
						device, deviceID = native.Device, native.DeviceID
					}
				}
				response := map[string]any{
					"document": document, "progress": locator.Progress, "percentage": locator.Percentage,
					"device": device, "timestamp": canonical.UpdatedAt.Truncate(time.Second).Unix(),
				}
				if deviceID != "" {
					response["device_id"] = deviceID
				}
				writeJSON(w, http.StatusOK, response)
				return
			}
			if !errors.Is(convertErr, position.ErrNotFound) {
				slog.Error("KOReader progress conversion failed", "username", username, "document", document, "alignment", canonical.AlignmentID, "segment", canonical.SegmentID, "offset", canonical.Offset, "error", convertErr)
				http.Error(w, "resolve progress", http.StatusInternalServerError)
				return
			}
		}
		if nativeErr != nil {
			writeJSON(w, http.StatusOK, map[string]any{})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"document": document, "progress": native.Progress, "percentage": native.Percentage,
			"device": native.Device, "device_id": native.DeviceID, "timestamp": native.UpdatedAt.Truncate(time.Second).Unix(),
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
