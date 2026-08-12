package api

import (
	"io/fs"
	"net/http"
	"path"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/koreader"
	"github.com/mahcks/aldus/server/internal/api/v1"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/position"
)

func Handler(web fs.FS, media http.FileSystem, store *position.Store, authStore *auth.Store, credentials koreader.Credentials) http.Handler {
	router := chi.NewRouter()
	apiRouter := router.With(cors)
	apiRouter.Mount("/api/v1", v1.Handler(store, authStore))
	apiRouter.Mount("/api", v1.Handler(store, authStore))
	koreaderHandler := koreader.Handler(store, credentials)
	router.Handle("/healthcheck", koreaderHandler)
	router.Handle("/users/*", koreaderHandler)
	router.Handle("/syncs/*", koreaderHandler)
	if media != nil {
		router.Handle("/media/*", cors(authStore.Middleware(http.StripPrefix("/media/", http.FileServer(media)))))
	}
	if web != nil {
		spa := spaHandler(web)
		router.Handle("/", spa)
		router.Handle("/*", spa)
	}
	return router
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		w.Header().Set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
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
