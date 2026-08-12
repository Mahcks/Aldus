package v1

import (
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/position"
)

func Handler(store *position.Store, authStore *auth.Store) http.Handler {
	router := chi.NewRouter()
	router.Get("/health", health)
	registerAuthRoutes(router, authStore)
	router.Group(func(router chi.Router) {
		router.Use(authStore.Middleware)
		registerSessionRoutes(router, authStore)
		registerAlignmentRoutes(router, store)
	})
	return router
}

func health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"status":"ok"}`)
}
