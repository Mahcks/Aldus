package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func Handler(deps Dependencies) http.Handler {
	router := chi.NewRouter()
	router.Get("/health", health)
	router.Get("/ready", ready(deps.Ready))
	registerAuthRoutes(router, deps.Auth)
	router.Group(func(router chi.Router) {
		router.Use(deps.Auth.Middleware)
		registerSessionRoutes(router, deps.Auth)
		registerReaderCredentialRoutes(router, deps.Auth)
		registerUserRoutes(router, deps.Auth)
		registerLibraryRoutes(router, deps.Catalog)
		registerSourceRoutes(router, deps.Sources)
		registerWorkRoutes(router, deps.Catalog, deps.Ingest)
		registerRepresentationRoutes(router, deps.Catalog)
		registerMediaRoutes(router, deps.Ingest)
		registerAlignmentJobRoutes(router, deps.AlignmentJobs, deps.Catalog)
		registerAlignmentRoutes(router, deps.Position, deps.Catalog)
		registerProgressRoutes(router, deps.Position, deps.Catalog)
		registerAcquisitionRoutes(router, deps.Acquisitions)
	})
	return router
}
