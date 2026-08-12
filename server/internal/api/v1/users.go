package v1

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/auth"
)

func registerUserRoutes(router chi.Router, store *auth.Store) {
	router.Get("/users", listUsers(store))
	router.Post("/users", createUser(store))
	router.Patch("/users/{userID}", updateUser(store))
}

func listUsers(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, _ := auth.UserFromContext(r.Context())
		limit, offset := pageParams(r)
		users, err := store.Users(r.Context(), actor, limit, offset)
		writeAuthResult(w, users, err)
	}
}

func createUser(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, _ := auth.UserFromContext(r.Context())
		var body struct {
			auth.Credentials
			Admin bool `json:"admin"`
		}
		if !decode(w, r, &body) {
			return
		}
		user, err := store.CreateUser(r.Context(), actor, body.Credentials, body.Admin)
		if err == nil {
			writeJSON(w, http.StatusCreated, user)
			return
		}
		writeAuthResult(w, user, err)
	}
}

func updateUser(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, _ := auth.UserFromContext(r.Context())
		var body struct {
			Disabled *bool `json:"disabled"`
		}
		if !decode(w, r, &body) {
			return
		}
		if body.Disabled == nil {
			http.Error(w, "invalid user", http.StatusBadRequest)
			return
		}
		err := store.SetDisabled(r.Context(), actor, chi.URLParam(r, "userID"), *body.Disabled)
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
	case err != nil:
		http.Error(w, "internal server error", http.StatusInternalServerError)
	default:
		writeJSON(w, http.StatusOK, value)
	}
}
