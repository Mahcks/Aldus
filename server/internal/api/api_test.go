package api

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestHandler(t *testing.T) {
	web := fstest.MapFS{"index.html": {Data: []byte("Aldus web")}}
	for _, test := range []struct {
		name, target, body string
		status             int
	}{
		{"health", "/api/health", `{"status":"ok"}`, http.StatusOK},
		{"versioned health", "/api/v1/health", `{"status":"ok"}`, http.StatusOK},
		{"spa fallback", "/library/book", "Aldus web", http.StatusOK},
		{"api root", "/api", "404 page not found", http.StatusNotFound},
		{"unknown api", "/api/nope", "404 page not found", http.StatusNotFound},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			Handler(fs.FS(web)).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, test.target, nil))
			if recorder.Code != test.status || !strings.Contains(recorder.Body.String(), test.body) {
				t.Fatalf("response = %d %q", recorder.Code, recorder.Body.String())
			}
		})
	}
}
