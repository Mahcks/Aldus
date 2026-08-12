package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMiddlewareCookieAndBearer(t *testing.T) {
	store, _ := openTestStore(t, Options{BootstrapToken: testBootstrapToken, SecureCookies: true})
	session, err := store.Bootstrap(context.Background(), testBootstrapToken, Credentials{Username: "alice", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	handler := store.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := UserFromContext(r.Context())
		if !ok || user.ID != session.User.ID {
			t.Fatalf("context user = %#v, %v", user, ok)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	for _, request := range []*http.Request{
		httpRequest(http.MethodGet, "Bearer "+session.Token, nil),
		httpRequest(http.MethodGet, "", &http.Cookie{Name: CookieName, Value: session.Token}),
	} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusNoContent {
			t.Fatalf("authenticated status = %d", recorder.Code)
		}
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", recorder.Code)
	}

	cookieRecorder := httptest.NewRecorder()
	store.SetCookie(cookieRecorder, session)
	cookie := cookieRecorder.Result().Cookies()[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" {
		t.Fatalf("session cookie = %#v", cookie)
	}
}

func httpRequest(method, authorization string, cookie *http.Cookie) *http.Request {
	request := httptest.NewRequest(method, "/", nil)
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	if cookie != nil {
		request.AddCookie(cookie)
	}
	return request
}
