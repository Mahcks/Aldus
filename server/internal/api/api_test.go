package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
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

func TestExactProgressCrossClientAcceptance(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	positions := position.New(db)
	if err := positions.SeedFixture(ctx); err != nil {
		t.Fatal(err)
	}
	accounts, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	reader, err := accounts.Setup(ctx, auth.Credentials{Username: "reader", Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	catalogStore := catalog.New(db)
	if err := catalogStore.SetMember(ctx, reader.User, "fixture-library", reader.User.ID, "owner"); err != nil {
		t.Fatal(err)
	}
	handler := Handler(Dependencies{Position: positions, Auth: accounts, Catalog: catalogStore, KOReader: koreader.Credentials{User: "reader", Key: "key"}})

	apiRequest := func(method, target, body string) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, target, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+reader.Token)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder
	}
	koRequest := func(method, target, body string) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, target, strings.NewReader(body))
		request.Header.Set("Accept", "application/vnd.koreader.v1+json")
		request.Header.Set("x-auth-user", "reader")
		request.Header.Set("x-auth-key", "key")
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder
	}

	web := apiRequest(http.MethodPut, "/api/works/fixture-work/progress", `{"alignment_id":"fixture-alignment","segment_id":"s0002","offset":350000,"expected_revision":0,"source_device":"web"}`)
	if web.Code != http.StatusOK {
		t.Fatalf("web save = %d %s", web.Code, web.Body.String())
	}
	pull := koRequest(http.MethodGet, "/syncs/progress/fixture-koreader-document", "")
	if pull.Code != http.StatusOK || !strings.Contains(pull.Body.String(), `p[2]`) || !strings.Contains(pull.Body.String(), `"device":"web"`) {
		t.Fatalf("KOReader pull = %d %s", pull.Code, pull.Body.String())
	}
	push := koRequest(http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"/body/DocFragment[1]/body/p[3].0","percentage":0.75,"device":"Kobo","device_id":"acceptance"}`)
	if push.Code != http.StatusOK {
		t.Fatalf("KOReader push = %d %s", push.Code, push.Body.String())
	}
	canonical := apiRequest(http.MethodGet, "/api/works/fixture-work/progress", "")
	if canonical.Code != http.StatusOK {
		t.Fatalf("canonical read = %d %s", canonical.Code, canonical.Body.String())
	}
	var progress struct {
		SegmentID    string `json:"segment_id"`
		Offset       int    `json:"offset"`
		SourceDevice string `json:"source_device"`
	}
	if err := json.Unmarshal(canonical.Body.Bytes(), &progress); err != nil {
		t.Fatal(err)
	}
	if progress.SegmentID != "s0003" || progress.SourceDevice != "koreader:Kobo acceptance" {
		t.Fatalf("canonical progress = %#v", progress)
	}
	audio := apiRequest(http.MethodPost, "/api/alignments/fixture-alignment/locators/audio", `{"segment_id":"s0003","offset":0}`)
	epub := apiRequest(http.MethodPost, "/api/alignments/fixture-alignment/locators/epub", `{"segment_id":"s0003","offset":0}`)
	if audio.Code != http.StatusOK || !strings.Contains(audio.Body.String(), `"timestamp_ms":7800`) {
		t.Fatalf("audio handoff = %d %s", audio.Code, audio.Body.String())
	}
	if epub.Code != http.StatusOK || !strings.Contains(epub.Body.String(), `"href":"text/chapter-1.xhtml"`) || !strings.Contains(epub.Body.String(), `epubcfi`) {
		t.Fatalf("EPUB handoff = %d %s", epub.Code, epub.Body.String())
	}
}

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

func TestReadinessReportsDependencyFailure(t *testing.T) {
	ready := httptest.NewRecorder()
	Handler(Dependencies{Ready: func(context.Context) error { return nil }}).ServeHTTP(ready, httptest.NewRequest(http.MethodGet, "/api/ready", nil))
	if ready.Code != http.StatusOK || !strings.Contains(ready.Body.String(), `"status":"ready"`) {
		t.Fatalf("ready = %d %s", ready.Code, ready.Body.String())
	}
	unavailable := httptest.NewRecorder()
	Handler(Dependencies{Ready: func(context.Context) error { return errors.New("storage unavailable") }}).ServeHTTP(unavailable, httptest.NewRequest(http.MethodGet, "/api/ready", nil))
	if unavailable.Code != http.StatusServiceUnavailable || !strings.Contains(unavailable.Body.String(), `"status":"unavailable"`) {
		t.Fatalf("unavailable = %d %s", unavailable.Code, unavailable.Body.String())
	}
}

func TestLegacyRawMediaRouteIsNotMounted(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/media/alice.epub", nil)
	recorder := httptest.NewRecorder()
	Handler(Dependencies{Web: fstest.MapFS{"index.html": {Data: []byte("Aldus web")}}}).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("legacy media response = %d %q", recorder.Code, recorder.Body.String())
	}
}

func TestReaderAuthenticationFailuresAreRateLimited(t *testing.T) {
	for _, target := range []string{"/opds/", "/users/auth"} {
		handler := Handler(Dependencies{})
		for attempt := 1; attempt <= 11; attempt++ {
			request := httptest.NewRequest(http.MethodGet, target, nil)
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			want := http.StatusUnauthorized
			if attempt == 11 {
				want = http.StatusTooManyRequests
			}
			if recorder.Code != want {
				t.Fatalf("%s attempt %d = %d, want %d", target, attempt, recorder.Code, want)
			}
		}
	}
}

func TestAliasesShareLoginLimiter(t *testing.T) {
	db, err := database.Open(context.Background(), filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	authStore, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	session, err := authStore.Setup(context.Background(), auth.Credentials{Username: "admin", Password: "a-secure-test-password"})
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
	authStore, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	admin, err := authStore.Setup(ctx, auth.Credentials{Username: "max", Password: "Password321!"})
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
