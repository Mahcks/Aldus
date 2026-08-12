package v1

import (
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func Handler() http.Handler {
	router := chi.NewRouter()
	router.Get("/health", health)
	return router
}

func health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"status":"ok"}`)
}
