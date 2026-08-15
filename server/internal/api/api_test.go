package api

import (
	"context"
	"encoding/base64"
	"io/fs"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/mahcks/aldus/server/internal/api/koreader"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/ingest"
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
			Handler(Dependencies{Web: fs.FS(web), Position: position.New(db), Auth: authStore, Catalog: catalog.New(db), KOReader: koreader.Credentials{User: "aldus", Key: "aldus"}}).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, test.target, nil))
			if recorder.Code != test.status || !strings.Contains(recorder.Body.String(), test.body) {
				t.Fatalf("response = %d %q", recorder.Code, recorder.Body.String())
			}
		})
	}
	handler := Handler(Dependencies{Web: fs.FS(web), Position: position.New(db), Auth: authStore, Catalog: catalog.New(db), KOReader: koreader.Credentials{User: "aldus", Key: "aldus"}, AllowedOrigins: []string{"http://localhost:8081"}})
	for _, method := range []string{http.MethodPatch, http.MethodDelete} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodOptions, "/api/libraries/1", nil)
		request.Header.Set("Origin", "http://localhost:8081")
		request.Header.Set("Access-Control-Request-Method", method)
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusNoContent || recorder.Header().Get("Access-Control-Allow-Origin") != "http://localhost:8081" || recorder.Header().Get("Access-Control-Allow-Credentials") != "true" || !strings.Contains(recorder.Header().Get("Access-Control-Allow-Methods"), method) || !strings.Contains(recorder.Header().Get("Vary"), "Origin") {
			t.Fatalf("%s preflight response = %d %#v", method, recorder.Code, recorder.Header())
		}
	}
	rejected := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodOptions, "/api/libraries/1", nil)
	request.Header.Set("Origin", "https://evil.example")
	handler.ServeHTTP(rejected, request)
	if rejected.Code != http.StatusForbidden || rejected.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("rejected preflight = %d %#v", rejected.Code, rejected.Header())
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
	request.Header.Set("Origin", "http://localhost:8081")
	recorder := httptest.NewRecorder()
	Handler(Dependencies{Media: media, Position: position.New(db), Auth: authStore, Catalog: catalog.New(db), AllowedOrigins: []string{"http://localhost:8081"}}).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusPartialContent || recorder.Body.String() != "2345" || recorder.Header().Get("Access-Control-Allow-Origin") != "http://localhost:8081" {
		t.Fatalf("range response = %d %q %#v", recorder.Code, recorder.Body.String(), recorder.Header())
	}
}

func TestAliasesShareLoginLimiter(t *testing.T) {
	db, err := database.Open(context.Background(), filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	authStore, err := auth.New(db, auth.Options{BootstrapToken: "bootstrap"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := authStore.Bootstrap(context.Background(), "bootstrap", auth.Credentials{Username: "admin", Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(Dependencies{Position: position.New(db), Auth: authStore, Catalog: catalog.New(db), AllowedOrigins: []string{"http://localhost:8081"}})
	cookieRequest := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	cookieRequest.Header.Set("Origin", "http://localhost:8081")
	cookieRequest.AddCookie(&http.Cookie{Name: auth.CookieName, Value: session.Token})
	cookieResponse := httptest.NewRecorder()
	handler.ServeHTTP(cookieResponse, cookieRequest)
	if cookieResponse.Code != http.StatusOK || cookieResponse.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("cross-origin cookie response = %d %#v", cookieResponse.Code, cookieResponse.Header())
	}
	for i := 0; i < 11; i++ {
		prefix := "/api"
		if i%2 == 1 {
			prefix = "/api/v1"
		}
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, prefix+"/auth/login", strings.NewReader(`{"username":"nobody","password":"bad"}`))
		request.RemoteAddr = "192.0.2.1:1234"
		handler.ServeHTTP(recorder, request)
		if i == 10 && recorder.Code != http.StatusTooManyRequests {
			t.Fatalf("shared attempt 11 = %d", recorder.Code)
		}
	}
}

func TestCookieAuthenticatedLibraryWorkCoverFlow(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	authStore, err := auth.New(db, auth.Options{BootstrapToken: "bootstrap"})
	if err != nil {
		t.Fatal(err)
	}
	admin, err := authStore.Bootstrap(ctx, "bootstrap", auth.Credentials{Username: "max", Password: "Password321!"})
	if err != nil {
		t.Fatal(err)
	}
	catalogStore := catalog.New(db)
	library, err := catalogStore.CreateLibrary(ctx, admin.User, "Library")
	if err != nil {
		t.Fatal(err)
	}
	work, err := catalogStore.CreateWork(ctx, admin.User, library.ID, "Alice", "Lewis Carroll")
	if err != nil {
		t.Fatal(err)
	}
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err := catalogStore.UploadCover(ctx, admin.User, work.ID, strings.NewReader(string(png))); err != nil {
		t.Fatal(err)
	}
	if err := catalogStore.RestoreCover(ctx, admin.User, work.ID); err != nil {
		t.Fatal(err)
	}
	mediaStore, err := ingest.New(db, ingest.Options{Root: t.TempDir(), MaxBytes: 1 << 20, Probe: func(context.Context, string) error { return nil }})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(Handler(Dependencies{Position: position.New(db), Auth: authStore, Catalog: catalogStore, Ingest: mediaStore}))
	defer server.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	login, err := client.Post(server.URL+"/api/auth/login", "application/json", strings.NewReader(`{"username":"max","password":"Password321!"}`))
	if err != nil {
		t.Fatal(err)
	}
	if login.StatusCode != http.StatusOK {
		t.Fatalf("login = %d", login.StatusCode)
	}
	login.Body.Close()
	for _, target := range []string{"/api/libraries", "/api/works/" + work.ID, "/api/works/" + work.ID + "/covers"} {
		response, err := client.Get(server.URL + target)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("GET %s = %d", target, response.StatusCode)
		}
	}
}
