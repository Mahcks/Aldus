package v1

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/acquisition"
	"github.com/mahcks/aldus/server/internal/alignment"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/backup"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/diagnostics"
	"github.com/mahcks/aldus/server/internal/position"
)

func TestResolveAudioAndUpdateProgress(t *testing.T) {
	handler, token := testHandler(t)

	response := request(t, handler, token, http.MethodPost, "/alignments/fixture-alignment/resolve/audio", `{"resource":"fixture/book.m4b","timestamp_ms":0}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"segment_id":"s0001"`) || !strings.Contains(response.Body.String(), `"offset":0`) {
		t.Fatalf("resolve intro response = %d %s", response.Code, response.Body.String())
	}
	response = request(t, handler, token, http.MethodPost, "/alignments/fixture-alignment/resolve/audio", `{"resource":"fixture/book.m4b","timestamp_ms":4420}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"segment_id":"s0002"`) || !strings.Contains(response.Body.String(), `"offset":350000`) {
		t.Fatalf("resolve response = %d %s", response.Code, response.Body.String())
	}
	response = request(t, handler, token, http.MethodPut, "/alignments/fixture-alignment/progress", `{"segment_id":"s0002","offset":350000,"expected_revision":0,"source_device":"web"}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"revision":1`) {
		t.Fatalf("update response = %d %s", response.Code, response.Body.String())
	}
}

func TestMetadataProviderFailureIsServiceUnavailable(t *testing.T) {
	response := httptest.NewRecorder()
	writeCatalogResult(response, nil, fmt.Errorf("refresh metadata: %w", catalog.ErrMetadataUnavailable))
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "Open Library is temporarily unavailable") {
		t.Fatalf("response = %d %q", response.Code, response.Body.String())
	}
}

func TestSystemDiagnosticsAreAuthenticatedAndAdminOnly(t *testing.T) {
	handler, token := testHandler(t)
	response := request(t, handler, token, http.MethodGet, "/system/diagnostics", "")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"database_status":"ok"`) {
		t.Fatalf("diagnostics = %d %s", response.Code, response.Body.String())
	}
	unauthorized := request(t, handler, "", http.MethodGet, "/system/diagnostics", "")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized diagnostics = %d", unauthorized.Code)
	}
}

func TestAdminCanCreateDownloadAndDeleteBackup(t *testing.T) {
	handler, token := testHandler(t)
	created := request(t, handler, token, http.MethodPost, "/system/backups", "")
	if created.Code != http.StatusCreated {
		t.Fatalf("create backup = %d %s", created.Code, created.Body.String())
	}
	var archive contracts.BackupArchive
	if err := json.Unmarshal(created.Body.Bytes(), &archive); err != nil || archive.Name == "" || archive.SizeBytes == 0 {
		t.Fatalf("created backup = %#v, %v", archive, err)
	}
	listed := request(t, handler, token, http.MethodGet, "/system/backups", "")
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), archive.Name) {
		t.Fatalf("list backups = %d %s", listed.Code, listed.Body.String())
	}
	downloaded := request(t, handler, token, http.MethodGet, "/system/backups/"+archive.Name, "")
	if downloaded.Code != http.StatusOK || downloaded.Header().Get("Content-Type") != "application/gzip" {
		t.Fatalf("download backup = %d %s", downloaded.Code, downloaded.Body.String())
	}
	deleted := request(t, handler, token, http.MethodDelete, "/system/backups/"+archive.Name, "")
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete backup = %d %s", deleted.Code, deleted.Body.String())
	}
}

func TestDeleteCurrentAccount(t *testing.T) {
	handler, token := testHandler(t)
	created := request(t, handler, token, http.MethodPost, "/users", `{"username":"other-admin","display_name":"Other Admin","admin":true}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create second admin = %d %s", created.Code, created.Body.String())
	}
	deleted := request(t, handler, token, http.MethodDelete, "/auth/me", `{"password":"a-secure-test-password"}`)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete current account = %d %s", deleted.Code, deleted.Body.String())
	}
	invalid := request(t, handler, token, http.MethodGet, "/auth/me", "")
	if invalid.Code != http.StatusUnauthorized {
		t.Fatalf("deleted session = %d %s", invalid.Code, invalid.Body.String())
	}
	unauthorized := request(t, handler, "", http.MethodDelete, "/auth/me", "")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized deletion = %d", unauthorized.Code)
	}
}

func TestDeleteGuestAccount(t *testing.T) {
	path := filepath.Join(t.TempDir(), "aldus.db")
	db, err := database.Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := position.New(db).SeedFixture(context.Background()); err != nil {
		t.Fatal(err)
	}
	accounts, err := auth.New(db, auth.Options{DemoLibraryID: "fixture-library"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := accounts.Setup(context.Background(), auth.Credentials{Username: "admin", Password: "a-secure-test-password"}); err != nil {
		t.Fatal(err)
	}
	guest, err := accounts.CreateDemoSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(Dependencies{Auth: accounts, Catalog: catalog.New(db), Position: position.New(db), Acquisitions: acquisition.NewStore(db, nil)})
	deleted := request(t, handler, guest.Token, http.MethodDelete, "/auth/me", `{}`)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete guest = %d %s", deleted.Code, deleted.Body.String())
	}
}

func TestRouteContract(t *testing.T) {
	handler, _ := testHandler(t)
	var got []string
	if err := chi.Walk(handler.(chi.Routes), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		got = append(got, method+" "+route)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"GET /alignment-jobs/{jobID}", "GET /alignments/{alignmentID}", "GET /alignments/{alignmentID}/progress", "GET /auth/me", "GET /health", "GET /ready", "GET /libraries", "GET /libraries/{libraryID}", "GET /libraries/{libraryID}/members", "GET /libraries/{libraryID}/representations/{representationID}/media", "GET /libraries/{libraryID}/works", "GET /media/{mediaID}", "GET /representations/{representationID}", "GET /representations/{representationID}/state", "GET /setup/status", "GET /users", "GET /works", "GET /works/{workID}", "GET /works/{workID}/alignment-jobs", "GET /works/{workID}/covers/search", "GET /works/{workID}/preference", "GET /works/{workID}/progress", "GET /works/{workID}/representations",
		"DELETE /libraries/{libraryID}", "DELETE /libraries/{libraryID}/members/{userID}", "DELETE /representations/{representationID}", "DELETE /works/{workID}", "DELETE /works/{workID}/cover",
		"PATCH /libraries/{libraryID}", "PATCH /representations/{representationID}", "PATCH /users/{userID}", "PATCH /works/{workID}",
		"POST /alignment-jobs", "POST /alignment-jobs/{jobID}/cancel", "POST /alignments/{alignmentID}/locators/audio", "POST /alignments/{alignmentID}/locators/epub", "POST /alignments/{alignmentID}/resolve/audio", "POST /alignments/{alignmentID}/resolve/epub", "POST /auth/demo", "POST /auth/demo/pair", "POST /auth/login", "POST /auth/logout", "POST /libraries", "POST /libraries/{libraryID}/representations/{representationID}/media", "POST /libraries/{libraryID}/works", "POST /setup", "POST /users", "POST /works/{workID}/activity", "POST /works/{workID}/metadata/refresh", "POST /works/{workID}/representations",
		"PUT /activity/{sessionID}", "PUT /alignments/{alignmentID}/progress", "PUT /libraries/{libraryID}/members/{userID}", "PUT /representations/{representationID}/state", "PUT /works/{workID}/cover", "PUT /works/{workID}/preference", "PUT /works/{workID}/progress", "PUT /works/{workID}/status",
	}
	want = append(want, "GET /covers/{coverID}", "GET /media/{mediaID}/cover", "GET /works/{workID}/covers", "POST /works/{workID}/cover", "PATCH /works/{workID}/cover/settings", "DELETE /works/{workID}/covers/{coverID}")
	want = append(want, "GET /media/{mediaID}/chapters")
	want = append(want, "GET /system/diagnostics")
	want = append(want, "GET /system/backups", "POST /system/backups", "GET /system/backups/{name}", "DELETE /system/backups/{name}")
	want = append(want, "DELETE /auth/me")
	want = append(want, "GET /me/reader-credentials", "POST /me/reader-credentials", "DELETE /me/reader-credentials/{credentialID}")
	want = append(want, "GET /acquisition-settings", "PUT /acquisition-settings", "POST /acquisition-settings/test", "GET /acquisition-capabilities", "GET /me/acquisition-tracker", "POST /me/acquisition-tracker/seen", "GET /libraries/{libraryID}/acquisition-requests", "POST /libraries/{libraryID}/acquisition-requests", "GET /libraries/{libraryID}/acquisition-requests/{requestID}/search", "POST /libraries/{libraryID}/acquisition-requests/{requestID}/select", "POST /libraries/{libraryID}/acquisition-requests/{requestID}/retry", "POST /libraries/{libraryID}/acquisition-requests/{requestID}/cancel", "POST /libraries/{libraryID}/acquisition-requests/{requestID}/dismiss", "POST /libraries/{libraryID}/acquisition-discoveries", "POST /libraries/{libraryID}/acquisition-discoveries/{discoveryID}/select", "POST /libraries/{libraryID}/acquisition-discoveries/{discoveryID}/select-pair")
	want = append(want, "GET /search/titles")
	want = append(want, "PATCH /auth/me", "POST /auth/claim", "POST /auth/logout-all", "POST /users/{userID}/reset-password", "PUT /auth/me/password")
	want = append(want, "GET /reader-preferences", "PUT /reader-preferences")
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("routes = %#v\nwant %#v", got, want)
	}
}

func TestReaderPreferencesContract(t *testing.T) {
	handler, token := testHandler(t)
	defaults := request(t, handler, token, http.MethodGet, "/reader-preferences", "")
	if defaults.Code != http.StatusOK || !strings.Contains(defaults.Body.String(), `"font_family":"serif"`) || !strings.Contains(defaults.Body.String(), `"revision":0`) {
		t.Fatalf("default reader preferences = %d %s", defaults.Code, defaults.Body.String())
	}

	updated := request(t, handler, token, http.MethodPut, "/reader-preferences", `{"reader_layout":"scrolled","zoom":1.2,"reader_theme":"sepia","line_height":1.9,"margin":1,"font_family":"dyslexic","expected_revision":0}`)
	if updated.Code != http.StatusOK || !strings.Contains(updated.Body.String(), `"font_family":"dyslexic"`) || !strings.Contains(updated.Body.String(), `"revision":1`) {
		t.Fatalf("updated reader preferences = %d %s", updated.Code, updated.Body.String())
	}
}

func TestProgressConflictContract(t *testing.T) {
	handler, token := testHandler(t)
	first := request(t, handler, token, http.MethodPut, "/alignments/fixture-alignment/progress", `{"segment_id":"s0001","offset":0,"expected_revision":0,"source_device":"web"}`)
	if first.Code != http.StatusOK {
		t.Fatalf("first update = %d %s", first.Code, first.Body.String())
	}
	conflict := request(t, handler, token, http.MethodPut, "/alignments/fixture-alignment/progress", `{"segment_id":"s0002","offset":0,"expected_revision":0,"source_device":"other"}`)
	if conflict.Code != http.StatusConflict {
		t.Fatalf("conflict = %d %s", conflict.Code, conflict.Body.String())
	}
	for _, want := range []string{`"work_id":"fixture-work"`, `"alignment_id":"fixture-alignment"`, `"segment_id":"s0001"`, `"revision":1`} {
		if !strings.Contains(conflict.Body.String(), want) {
			t.Fatalf("conflict body = %s, want %s", conflict.Body.String(), want)
		}
	}
}

func TestMissingWorkPreferenceIsEmptyForVisibleWork(t *testing.T) {
	handler, token := testHandler(t)

	empty := request(t, handler, token, http.MethodGet, "/works/fixture-work/preference", "")
	if empty.Code != http.StatusOK || strings.TrimSpace(empty.Body.String()) != "null" {
		t.Fatalf("empty preference = %d %s", empty.Code, empty.Body.String())
	}
	missing := request(t, handler, token, http.MethodGet, "/works/missing/preference", "")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing work preference = %d %s", missing.Code, missing.Body.String())
	}
}

func TestWorkAlignmentJobListing(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := position.New(db).SeedFixture(ctx); err != nil {
		t.Fatal(err)
	}
	accounts, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	admin, err := accounts.Setup(ctx, auth.Credentials{Username: "admin", Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	sessions := map[string]auth.Session{}
	for _, role := range []string{"owner", "editor", "reader"} {
		user, _, err := accounts.CreateUser(ctx, admin.User, auth.Credentials{Username: role, Password: "a-secure-test-password"}, false)
		if err != nil {
			t.Fatal(err)
		}
		if err := catalog.New(db).SetMember(ctx, admin.User, "fixture-library", user.ID, role); err != nil {
			t.Fatal(err)
		}
		sessions[role], _ = accounts.Login(ctx, auth.Credentials{Username: role, Password: "a-secure-test-password"})
	}
	_, _, err = accounts.CreateUser(ctx, admin.User, auth.Credentials{Username: "outsider", Password: "a-secure-test-password"}, false)
	if err != nil {
		t.Fatal(err)
	}
	catalogStore := catalog.New(db)
	outsiderSession, _ := accounts.Login(ctx, auth.Credentials{Username: "outsider", Password: "a-secure-test-password"})
	manager, err := alignment.New(db, alignment.Options{MediaRoot: t.TempDir(), ArtifactRoot: t.TempDir(), Command: []string{"true"}, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)
	for i := 1; i <= 5; i++ {
		if _, err := db.ExecContext(ctx, `INSERT INTO media(id,representation_id,kind,path,sha256,created_at) VALUES(?, 'fixture-epub-representation','epub',?,?,?)`, fmt.Sprintf("epub-%d", i), fmt.Sprintf("epub-%d", i), strings.Repeat(fmt.Sprint(i), 64), now.Format(time.RFC3339Nano)); err != nil {
			t.Fatal(err)
		}
	}
	states := []string{"failed", "stale", "ready", "processing", "pending"}
	for i, state := range states {
		created := now.Add(time.Duration(i) * time.Minute).Format(time.RFC3339Nano)
		var alignmentID any
		if state == "ready" {
			alignmentID = "fixture-alignment"
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO alignment_jobs(id,alignment_id,epub_media_id,audio_media_id,state,worker_version,model,error_summary,created_at) VALUES(?,?,?, 'fixture-audio',?,'whisperx 3.8.6','base.en',?,?)`, fmt.Sprintf("job-%d", i), alignmentID, fmt.Sprintf("epub-%d", i+1), state, map[bool]string{true: "bounded failure"}[state == "failed"], created); err != nil {
			t.Fatal(err)
		}
	}
	handler := Handler(Dependencies{Position: position.New(db), Auth: accounts, Catalog: catalogStore, AlignmentJobs: manager})
	for role, session := range sessions {
		response := request(t, handler, session.Token, http.MethodGet, "/works/fixture-work/alignment-jobs?limit=3", "")
		if response.Code != http.StatusOK {
			t.Fatalf("%s list = %d %s", role, response.Code, response.Body.String())
		}
	}
	response := request(t, handler, sessions["reader"].Token, http.MethodGet, "/works/fixture-work/alignment-jobs", "")
	var jobs []contracts.AlignmentJob
	if err := json.Unmarshal(response.Body.Bytes(), &jobs); err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 5 || jobs[0].ID != "job-4" || jobs[1].State != "processing" || jobs[2].State != "ready" || jobs[2].AlignmentID != "fixture-alignment" || jobs[3].State != "stale" || jobs[4].Error != "bounded failure" {
		t.Fatalf("ordered jobs = %#v", jobs)
	}
	emptyWork, err := catalogStore.CreateWork(ctx, admin.User, "fixture-library", "No alignments", "")
	if err != nil {
		t.Fatal(err)
	}
	empty := request(t, handler, sessions["reader"].Token, http.MethodGet, "/works/"+emptyWork.ID+"/alignment-jobs", "")
	if empty.Code != http.StatusOK || empty.Body.String() != "[]\n" {
		t.Fatalf("empty list = %d %q", empty.Code, empty.Body.String())
	}
	denied := request(t, handler, outsiderSession.Token, http.MethodGet, "/works/fixture-work/alignment-jobs", "")
	if denied.Code != http.StatusNotFound || denied.Body.String() != "not found\n" {
		t.Fatalf("outsider list = %d %q", denied.Code, denied.Body.String())
	}
	missing := request(t, handler, sessions["reader"].Token, http.MethodGet, "/works/missing/alignment-jobs", "")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing list = %d", missing.Code)
	}
}

func TestReadingStatePersistsAcrossSessionsAndRemainsPrivate(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := position.New(db).SeedFixture(ctx); err != nil {
		t.Fatal(err)
	}
	authStore, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	first, err := authStore.Setup(ctx, auth.Credentials{Username: "reader", Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := authStore.Login(ctx, auth.Credentials{Username: "reader", Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	outsider, _, err := authStore.CreateUser(ctx, first.User, auth.Credentials{Username: "outsider", Password: "a-secure-test-password"}, false)
	if err != nil {
		t.Fatal(err)
	}
	outsiderSession, err := authStore.Login(ctx, auth.Credentials{Username: outsider.Username, Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(Dependencies{Position: position.New(db), Auth: authStore, Catalog: catalog.New(db)})

	updated := request(t, handler, first.Token, http.MethodPut, "/works/fixture-work/progress", `{"alignment_id":"fixture-alignment","segment_id":"s0002","offset":250000,"expected_revision":0,"source_device":"web"}`)
	if updated.Code != http.StatusOK || !strings.Contains(updated.Body.String(), `"revision":1`) {
		t.Fatalf("progress update = %d %s", updated.Code, updated.Body.String())
	}
	read := request(t, handler, second.Token, http.MethodGet, "/works/fixture-work/progress", "")
	if read.Code != http.StatusOK || !strings.Contains(read.Body.String(), `"segment_id":"s0002"`) {
		t.Fatalf("second-session read = %d %s", read.Code, read.Body.String())
	}
	state := request(t, handler, second.Token, http.MethodPut, "/representations/fixture-audio-representation/state", `{"audio_timestamp_ms":33295,"playback_speed":1.25,"expected_revision":0}`)
	if state.Code != http.StatusOK || !strings.Contains(state.Body.String(), `"audio_timestamp_ms":33295`) {
		t.Fatalf("representation state = %d %s", state.Code, state.Body.String())
	}
	for _, path := range []string{"/works/fixture-work/progress", "/representations/fixture-audio-representation/state"} {
		response := request(t, handler, outsiderSession.Token, http.MethodGet, path, "")
		if response.Code != http.StatusNotFound {
			t.Fatalf("outsider GET %s = %d %s", path, response.Code, response.Body.String())
		}
	}
	for path, body := range map[string]string{
		"/works/fixture-work/progress":                        `{"alignment_id":"fixture-alignment","segment_id":"s0001","offset":0,"expected_revision":0,"source_device":"other"}`,
		"/representations/fixture-audio-representation/state": `{"audio_timestamp_ms":1,"expected_revision":0}`,
	} {
		response := request(t, handler, outsiderSession.Token, http.MethodPut, path, body)
		if response.Code != http.StatusNotFound {
			t.Fatalf("outsider PUT %s = %d %s", path, response.Code, response.Body.String())
		}
	}
	if _, _, err := authStore.CreateUser(ctx, first.User, auth.Credentials{Username: "second-admin", Password: "a-secure-test-password"}, true); err != nil {
		t.Fatal(err)
	}
	if err := authStore.SetDisabled(ctx, first.User, first.User.ID, true); err != nil {
		t.Fatal(err)
	}
	disabled := request(t, handler, second.Token, http.MethodGet, "/works/fixture-work/progress", "")
	if disabled.Code != http.StatusUnauthorized {
		t.Fatalf("disabled user's session = %d %s", disabled.Code, disabled.Body.String())
	}
}

func TestAuthenticationRoutes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "aldus.db")
	db, err := database.Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	authStore, err := auth.New(db, auth.Options{SecureCookies: true})
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(Dependencies{Position: position.New(db), Auth: authStore, Catalog: catalog.New(db)})

	unauthorized := request(t, handler, "", http.MethodGet, "/auth/me", "")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated me = %d", unauthorized.Code)
	}
	mismatch := request(t, handler, "", http.MethodPost, "/setup", `{"username":"alice","password":"a-secure-test-password","password_confirmation":"different-password"}`)
	if mismatch.Code != http.StatusBadRequest {
		t.Fatalf("mismatched setup = %d %s", mismatch.Code, mismatch.Body.String())
	}
	setup := request(t, handler, "", http.MethodPost, "/setup", `{"username":"alice","password":"a-secure-test-password","password_confirmation":"a-secure-test-password"}`)
	if setup.Code != http.StatusCreated || !strings.Contains(setup.Body.String(), `"admin":true`) {
		t.Fatalf("setup = %d %s", setup.Code, setup.Body.String())
	}
	cookies := setup.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("setup cookies = %#v", cookies)
	}
	second := request(t, handler, "", http.MethodPost, "/setup", `{"username":"other","password":"a-secure-test-password","password_confirmation":"a-secure-test-password"}`)
	if second.Code != http.StatusNotFound {
		t.Fatalf("second setup = %d %s", second.Code, second.Body.String())
	}
	login := request(t, handler, "", http.MethodPost, "/auth/login", `{"username":"alice","password":"a-secure-test-password"}`)
	if login.Code != http.StatusOK || !strings.Contains(login.Body.String(), `"token":`) {
		t.Fatalf("login = %d %s", login.Code, login.Body.String())
	}
	if login.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("login cache control = %q", login.Header().Get("Cache-Control"))
	}
	cookieRequest := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	cookieRequest.AddCookie(login.Result().Cookies()[0])
	cookieResponse := httptest.NewRecorder()
	handler.ServeHTTP(cookieResponse, cookieRequest)
	if cookieResponse.Code != http.StatusOK || !strings.Contains(cookieResponse.Body.String(), `"username":"alice"`) {
		t.Fatalf("cookie authentication = %d %s", cookieResponse.Code, cookieResponse.Body.String())
	}
}

func TestUnclaimedAccountCannotUseProtectedRoutes(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	accounts, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	admin, err := accounts.Setup(ctx, auth.Credentials{Username: "admin", Password: "a-secure-admin-password"})
	if err != nil {
		t.Fatal(err)
	}
	reader, temporaryPassword, err := accounts.CreateUser(ctx, admin.User, auth.Credentials{Username: "reader"}, false)
	if err != nil {
		t.Fatal(err)
	}
	temporarySession, err := accounts.Login(ctx, auth.Credentials{Username: reader.Username, Password: temporaryPassword})
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(Dependencies{Auth: accounts, Catalog: catalog.New(db), Position: position.New(db)})
	blocked := request(t, handler, temporarySession.Token, http.MethodGet, "/libraries", "")
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("unclaimed library access = %d %s", blocked.Code, blocked.Body.String())
	}
	claimed := request(t, handler, temporarySession.Token, http.MethodPost, "/auth/claim", `{"username":"reader-owned","display_name":"Reader Owned","password":"a-secure-reader-password","password_confirmation":"a-secure-reader-password"}`)
	if claimed.Code != http.StatusOK {
		t.Fatalf("claim = %d %s", claimed.Code, claimed.Body.String())
	}
	var session contracts.Session
	if err := json.Unmarshal(claimed.Body.Bytes(), &session); err != nil || session.Token == "" || session.User.MustChangeCredentials {
		t.Fatalf("claim session = %#v, %v", session, err)
	}
	allowed := request(t, handler, session.Token, http.MethodGet, "/libraries", "")
	if allowed.Code != http.StatusOK {
		t.Fatalf("claimed library access = %d %s", allowed.Code, allowed.Body.String())
	}
}

func TestLimiterDiscardsExpiredAddresses(t *testing.T) {
	limiter := newLimiter(10, time.Millisecond, false)
	limiter.attempt["old"] = attempt{start: time.Now().Add(-time.Second), count: 1}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	limiter.middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })).ServeHTTP(recorder, request)
	if _, exists := limiter.attempt["old"]; exists {
		t.Fatal("expired limiter entry was retained")
	}
}

func TestLimiterUsesForwardedAddressOnlyWhenConfigured(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	for _, trust := range []bool{false, true} {
		limiter := newLimiter(1, time.Hour, trust)
		forwarded := httptest.NewRequest(http.MethodPost, "/auth/demo", nil)
		forwarded.RemoteAddr = "172.18.0.2:1234"
		forwarded.Header.Set("X-Forwarded-For", "198.51.100.4")
		limiter.middleware(next).ServeHTTP(httptest.NewRecorder(), forwarded)
		key := "/auth/demo\x00" + map[bool]string{false: "172.18.0.2", true: "198.51.100.4"}[trust]
		if limiter.attempt[key].count != 1 {
			t.Fatalf("trust proxy %v did not use expected address", trust)
		}
	}
	limiter := newLimiter(1, time.Hour, true)
	fly := httptest.NewRequest(http.MethodPost, "/auth/demo", nil)
	fly.RemoteAddr = "172.18.0.2:1234"
	fly.Header.Set("Fly-Client-IP", "203.0.113.8")
	fly.Header.Set("X-Forwarded-For", "198.51.100.4")
	limiter.middleware(next).ServeHTTP(httptest.NewRecorder(), fly)
	if limiter.attempt["/auth/demo\x00203.0.113.8"].count != 1 {
		t.Fatal("trusted Fly client address was not preferred")
	}
}

func TestDemoAuthenticationContract(t *testing.T) {
	db, err := database.Open(context.Background(), filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := position.New(db).SeedFixture(context.Background()); err != nil {
		t.Fatal(err)
	}
	accounts, err := auth.New(db, auth.Options{DemoLibraryID: "fixture-library"})
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(Dependencies{Auth: accounts})
	status := request(t, handler, "", http.MethodGet, "/setup/status", "")
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"demo_available":true`) {
		t.Fatalf("setup status = %d %s", status.Code, status.Body.String())
	}
	created := request(t, handler, "", http.MethodPost, "/auth/demo", "")
	if created.Code != http.StatusCreated || !strings.Contains(created.Body.String(), `"demo_expires_at":`) {
		t.Fatalf("demo login = %d %s", created.Code, created.Body.String())
	}
	if created.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("demo cache control = %q", created.Header().Get("Cache-Control"))
	}
	var session contracts.Session
	if err := json.Unmarshal(created.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.DemoCredentials == nil || session.DemoCredentials.Username != session.User.Username || session.DemoCredentials.Password == "" {
		t.Fatalf("demo credentials = %#v", session.DemoCredentials)
	}
	if session.DemoPairing == nil || len(session.DemoPairing.Code) != 9 {
		t.Fatalf("demo pairing = %#v", session.DemoPairing)
	}
	me := request(t, handler, session.Token, http.MethodGet, "/auth/me", "")
	if me.Code != http.StatusOK || !strings.Contains(me.Body.String(), `"username":"guest-`) || strings.Contains(me.Body.String(), session.DemoCredentials.Password) {
		t.Fatalf("demo session = %d %s", me.Code, me.Body.String())
	}
	paired := request(t, handler, "", http.MethodPost, "/auth/demo/pair", `{"code":"`+session.DemoPairing.Code+`"}`)
	if paired.Code != http.StatusOK || !strings.Contains(paired.Body.String(), `"id":"`+session.User.ID+`"`) {
		t.Fatalf("paired demo = %d %s", paired.Code, paired.Body.String())
	}
	reused := request(t, handler, "", http.MethodPost, "/auth/demo/pair", `{"code":"`+session.DemoPairing.Code+`"}`)
	if reused.Code != http.StatusUnauthorized {
		t.Fatalf("reused pairing code = %d %s", reused.Code, reused.Body.String())
	}
}

func TestAlignmentJobDatabaseErrorResponse(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeAlignmentJobError(recorder, errors.New("database unavailable"))
	if recorder.Code != http.StatusInternalServerError || recorder.Body.String() != "internal server error\n" {
		t.Fatalf("database error response = %d %q", recorder.Code, recorder.Body.String())
	}
}

func TestAcquisitionRequestHTTPContract(t *testing.T) {
	handler, token := testHandler(t)
	created := request(t, handler, token, http.MethodPost, "/libraries/fixture-library/acquisition-requests", `{"query":"Alice Carroll","source_id":"fixture-source"}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create acquisition request = %d %s", created.Code, created.Body.String())
	}
	var value contracts.AcquisitionRequest
	if err := json.Unmarshal(created.Body.Bytes(), &value); err != nil || value.Query != "Alice Carroll" || value.Status != "requested" {
		t.Fatalf("created acquisition request = %#v, %v", value, err)
	}
	listed := request(t, handler, token, http.MethodGet, "/libraries/fixture-library/acquisition-requests", "")
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), value.ID) {
		t.Fatalf("list acquisition requests = %d %s", listed.Code, listed.Body.String())
	}
	search := request(t, handler, token, http.MethodGet, "/libraries/fixture-library/acquisition-requests/"+value.ID+"/search", "")
	if search.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured acquisition search = %d %s", search.Code, search.Body.String())
	}
}

func testHandler(t *testing.T) (http.Handler, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "aldus.db")
	db, err := database.Open(context.Background(), path)
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
	session, err := authStore.Setup(context.Background(), auth.Credentials{Username: "reader", Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('fixture-source','fixture-library','local','Downloads','/downloads',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	client, err := acquisition.New(acquisition.Options{})
	if err != nil {
		t.Fatal(err)
	}
	return Handler(Dependencies{Position: position.New(db), Auth: authStore, Catalog: catalog.New(db), Acquisitions: acquisition.NewStore(db, client), Diagnostics: diagnostics.New(db, filepath.Dir(path), nil, "test", "test"), Backups: backup.NewManager(filepath.Dir(path), t.TempDir(), "test")}), session.Token
}

func request(t *testing.T, handler http.Handler, token, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(recorder, request)
	return recorder
}
