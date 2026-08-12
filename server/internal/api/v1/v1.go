package v1

import (
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/position"
)

func Handler(store *position.Store, authStore *auth.Store, catalogStore *catalog.Store) http.Handler {
	router := chi.NewRouter()
	router.Get("/health", health)
	registerAuthRoutes(router, authStore)
	router.Group(func(router chi.Router) {
		router.Use(authStore.Middleware)
		registerSessionRoutes(router, authStore)
		registerUserRoutes(router, authStore)
		registerCatalogRoutes(router, catalogStore)
		registerAlignmentRoutes(router, store, catalogStore)
	})
	return router
}

func health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"status":"ok"}`)
}
