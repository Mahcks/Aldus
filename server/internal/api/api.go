package api

import (
	"io/fs"
	"net/http"
	"path"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/v1"
)

func Handler(web fs.FS) http.Handler {
	router := chi.NewRouter()
	router.Mount("/api/v1", v1.Handler())
	router.Mount("/api", v1.Handler())
	if web != nil {
		spa := spaHandler(web)
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
		}
		r.URL.Path = "/"
		files.ServeHTTP(w, r)
	})
}
