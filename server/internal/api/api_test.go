package api

import (
	"context"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/mahcks/aldus/server/internal/api/koreader"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/position"
)

func TestHandler(t *testing.T) {
	web := fstest.MapFS{
		"index.html":   {Data: []byte("Aldus web")},
		"anchors.html": {Data: []byte("Alice anchors")},
	}
	databasePath := filepath.Join(t.TempDir(), "aldus.db")
	db, err := database.Open(context.Background(), databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := position.New(db).SeedFixture(context.Background()); err != nil {
		t.Fatal(err)
	}
	authStore, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, target, body string
		status             int
	}{
		{"health", "/api/health", `{"status":"ok"}`, http.StatusOK},
		{"versioned health", "/api/v1/health", `{"status":"ok"}`, http.StatusOK},
		{"spa fallback", "/library/book", "Aldus web", http.StatusOK},
		{"static route", "/anchors", "Alice anchors", http.StatusOK},
		{"api root", "/api", "404 page not found", http.StatusNotFound},
		{"unknown api", "/api/nope", "404 page not found", http.StatusNotFound},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			Handler(fs.FS(web), nil, position.New(db), authStore, catalog.New(db), nil, koreader.Credentials{User: "aldus", Key: "aldus"}).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, test.target, nil))
			if recorder.Code != test.status || !strings.Contains(recorder.Body.String(), test.body) {
				t.Fatalf("response = %d %q", recorder.Code, recorder.Body.String())
			}
		})
	}
	recorder := httptest.NewRecorder()
	Handler(fs.FS(web), nil, position.New(db), authStore, catalog.New(db), nil, koreader.Credentials{User: "aldus", Key: "aldus"}).ServeHTTP(recorder, httptest.NewRequest(http.MethodOptions, "/api/alignments/fixture-alignment/progress", nil))
	if recorder.Code != http.StatusNoContent || recorder.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("preflight response = %d %#v", recorder.Code, recorder.Header())
	}
}

func TestMediaSupportsCrossOriginRanges(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "aldus.db")
	db, err := database.Open(context.Background(), databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	authStore, err := auth.New(db, auth.Options{BootstrapToken: "test-bootstrap-token"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := authStore.Bootstrap(context.Background(), "test-bootstrap-token", auth.Credentials{Username: "reader", Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	media := http.FS(fstest.MapFS{"alice.epub": {Data: []byte("0123456789")}})
	request := httptest.NewRequest(http.MethodGet, "/media/alice.epub", nil)
	request.Header.Set("Range", "bytes=2-5")
	request.Header.Set("Authorization", "Bearer "+session.Token)
	recorder := httptest.NewRecorder()
	Handler(nil, media, position.New(db), authStore, catalog.New(db), nil, koreader.Credentials{}).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusPartialContent || recorder.Body.String() != "2345" || recorder.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("range response = %d %q %#v", recorder.Code, recorder.Body.String(), recorder.Header())
	}
}
