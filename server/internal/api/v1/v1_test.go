package v1

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/position"
)

func TestResolveAudioAndUpdateProgress(t *testing.T) {
	handler, token := testHandler(t)

	response := request(t, handler, token, http.MethodPost, "/alignments/fixture-alignment/resolve/audio", `{"resource":"fixture/book.m4b","timestamp_ms":4420}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"segment_id":"s0002"`) || !strings.Contains(response.Body.String(), `"offset":350000`) {
		t.Fatalf("resolve response = %d %s", response.Code, response.Body.String())
	}
	response = request(t, handler, token, http.MethodPut, "/alignments/fixture-alignment/progress", `{"segment_id":"s0002","offset":350000,"expected_revision":0,"source_device":"web"}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"revision":1`) {
		t.Fatalf("update response = %d %s", response.Code, response.Body.String())
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
	const want = `{"alignment_id":"fixture-alignment","segment_id":"s0001","offset":0,"revision":1,`
	if !strings.HasPrefix(conflict.Body.String(), want) {
		t.Fatalf("conflict body = %s, want prefix %s", conflict.Body.String(), want)
	}
}

func TestAuthenticationRoutes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "aldus.db")
	db, err := database.Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	authStore, err := auth.New(db, auth.Options{BootstrapToken: "test-bootstrap-token", SecureCookies: true})
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(position.New(db), authStore)

	unauthorized := request(t, handler, "", http.MethodGet, "/auth/me", "")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated me = %d", unauthorized.Code)
	}
	setup := request(t, handler, "", http.MethodPost, "/setup", `{"bootstrap_token":"test-bootstrap-token","username":"alice","password":"a-secure-test-password"}`)
	if setup.Code != http.StatusCreated || !strings.Contains(setup.Body.String(), `"admin":true`) {
		t.Fatalf("setup = %d %s", setup.Code, setup.Body.String())
	}
	cookies := setup.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("setup cookies = %#v", cookies)
	}
	second := request(t, handler, "", http.MethodPost, "/setup", `{"bootstrap_token":"test-bootstrap-token","username":"other","password":"a-secure-test-password"}`)
	if second.Code != http.StatusNotFound {
		t.Fatalf("second setup = %d %s", second.Code, second.Body.String())
	}
	login := request(t, handler, "", http.MethodPost, "/auth/login", `{"username":"alice","password":"a-secure-test-password"}`)
	if login.Code != http.StatusOK || !strings.Contains(login.Body.String(), `"token":`) {
		t.Fatalf("login = %d %s", login.Code, login.Body.String())
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
	authStore, err := auth.New(db, auth.Options{BootstrapToken: "test-bootstrap-token"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := authStore.Bootstrap(context.Background(), "test-bootstrap-token", auth.Credentials{Username: "reader", Password: "a-secure-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	return Handler(position.New(db), authStore), session.Token
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
