package api

import (
	"io/fs"
	"net/http"
	"path"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/koreader"
	"github.com/mahcks/aldus/server/internal/api/opds"
	"github.com/mahcks/aldus/server/internal/api/v1"
)

func Handler(deps Dependencies) http.Handler {
	router := chi.NewRouter()
	router.Use(requestLogger)
	apiRouter := router.With(cors(deps.AllowedOrigins))
	v1Handler := v1.Handler(v1.Dependencies{Position: deps.Position, Auth: deps.Auth, Catalog: deps.Catalog, Collections: deps.Collections, Ingest: deps.Ingest, Sources: deps.Sources, AlignmentJobs: deps.AlignmentJobs, Acquisitions: deps.Acquisitions, AcquisitionPolicies: deps.AcquisitionPolicies, TitleRequests: deps.TitleRequests, Notifications: deps.Notifications, Diagnostics: deps.Diagnostics, Backups: deps.Backups, TrustProxyHeaders: deps.TrustProxyHeaders, Ready: deps.Ready})
	apiRouter.Mount("/api/v1", v1Handler)
	apiRouter.Mount("/api", v1Handler)
	router.Mount("/opds", opds.Handler(opds.Dependencies{Auth: deps.Auth, Catalog: deps.Catalog, Ingest: deps.Ingest}))
	koreaderHandler := koreader.Handler(deps.Position, deps.Auth, deps.KOReader)
	router.Handle("/healthcheck", koreaderHandler)
	router.Handle("/users/*", koreaderHandler)
	router.Handle("/syncs/*", koreaderHandler)
	if deps.Media != nil {
		router.Handle("/media/*", cors(deps.AllowedOrigins)(deps.Auth.Middleware(http.StripPrefix("/media/", http.FileServer(deps.Media)))))
	}
	if deps.Web != nil {
		spa := spaHandler(deps.Web)
		router.Handle("/", spa)
		router.Handle("/*", spa)
	}
	return router
}

func spaHandler(web fs.FS) http.Handler {
	files := http.FileServer(http.FS(web))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := path.Clean(r.URL.Path)[1:]
		if name != "" {
			if info, err := fs.Stat(web, name); err == nil && !info.IsDir() {
				files.ServeHTTP(w, r)
				return
			}
			if info, err := fs.Stat(web, name+".html"); err == nil && !info.IsDir() {
				r.URL.Path += ".html"
				files.ServeHTTP(w, r)
				return
			}
		}
		r.URL.Path = "/"
		files.ServeHTTP(w, r)
	})
}
