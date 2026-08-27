package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
)

type userContextKey struct{}

func (s *Store) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := RequestToken(r)
		user, err := s.Authenticate(r.Context(), token)
		if errors.Is(err, ErrUnauthenticated) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey{}, user)))
	})
}

func (s *Store) RequireClaimed(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := UserFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if user.MustChangeCredentials {
			http.Error(w, "Finish setting up your account.", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func UserFromContext(ctx context.Context) (User, bool) {
	user, ok := ctx.Value(userContextKey{}).(User)
	return user, ok
}

func RequestToken(r *http.Request) string {
	authorization := r.Header.Get("Authorization")
	if scheme, value, ok := strings.Cut(authorization, " "); ok && strings.EqualFold(scheme, "Bearer") {
		return strings.TrimSpace(value)
	}
	cookie, err := r.Cookie(CookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func (s *Store) SetCookie(w http.ResponseWriter, session Session) {
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: session.Token, Path: "/", Expires: session.ExpiresAt,
		MaxAge: int(time.Until(session.ExpiresAt).Seconds()), HttpOnly: true, Secure: s.options.SecureCookies, SameSite: http.SameSiteLaxMode,
	})
}

func (s *Store) ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: "", Path: "/", MaxAge: -1, Expires: time.Unix(1, 0),
		HttpOnly: true, Secure: s.options.SecureCookies, SameSite: http.SameSiteLaxMode,
	})
}
