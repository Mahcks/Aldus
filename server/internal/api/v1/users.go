package v1

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/auth"
)

func registerUserRoutes(router chi.Router, store *auth.Store) {
	router.Get("/users", listUsers(store))
	router.Post("/users", createUser(store))
	router.Patch("/users/{userID}", updateUser(store))
	router.Post("/users/{userID}/reset-password", resetUserPassword(store))
}

func listUsers(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, _ := auth.UserFromContext(r.Context())
		limit, offset := pageParams(r)
		users, err := store.Users(r.Context(), actor, limit, offset)
		values := make([]contracts.User, len(users))
		for i, user := range users {
			values[i] = userDTO(user)
		}
		writeAuthResult(w, values, err)
	}
}

func createUser(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, _ := auth.UserFromContext(r.Context())
		var body contracts.CreateUserRequest
		if !decode(w, r, &body) {
			return
		}
		user, temporaryPassword, err := store.CreateUser(r.Context(), actor, auth.Credentials{Username: body.Username, DisplayName: body.DisplayName, Password: body.Password}, body.Admin, body.AdminNote)
		if err == nil {
			w.Header().Set("Cache-Control", "no-store")
			writeJSON(w, http.StatusCreated, contracts.CreatedUser{User: userDTO(user), TemporaryPassword: temporaryPassword})
			return
		}
		writeAuthResult(w, user, err)
	}
}

func resetUserPassword(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, _ := auth.UserFromContext(r.Context())
		temporaryPassword, err := store.ResetPassword(r.Context(), actor, chi.URLParam(r, "userID"))
		if err == nil {
			w.Header().Set("Cache-Control", "no-store")
			writeJSON(w, http.StatusOK, contracts.ResetPasswordResponse{TemporaryPassword: temporaryPassword})
			return
		}
		writeAuthResult(w, nil, err)
	}
}

func updateUser(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, _ := auth.UserFromContext(r.Context())
		var body contracts.UpdateUserRequest
		if !decode(w, r, &body) {
			return
		}
		if (body.Disabled == nil) == (body.AdminNote == nil) {
			http.Error(w, "invalid user", http.StatusBadRequest)
			return
		}
		var err error
		if body.Disabled != nil {
			err = store.SetDisabled(r.Context(), actor, chi.URLParam(r, "userID"), *body.Disabled)
		}
		if err == nil && body.AdminNote != nil {
			err = store.SetAdminNote(r.Context(), actor, chi.URLParam(r, "userID"), *body.AdminNote)
		}
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeAuthResult(w, nil, err)
	}
}

func writeAuthResult(w http.ResponseWriter, value any, err error) {
	switch {
	case errors.Is(err, auth.ErrForbidden):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, auth.ErrInvalid), errors.Is(err, auth.ErrUsernameTaken):
		http.Error(w, "invalid user", http.StatusBadRequest)
	case errors.Is(err, auth.ErrLastAdmin):
		http.Error(w, "last administrator", http.StatusConflict)
	case errors.Is(err, auth.ErrLastOwner):
		http.Error(w, "last enabled library owner", http.StatusConflict)
	case err != nil:
		slog.Error("auth request failed", "error", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
	default:
		writeJSON(w, http.StatusOK, value)
	}
}
