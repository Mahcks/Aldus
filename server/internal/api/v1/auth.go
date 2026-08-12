package v1

import (
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/auth"
)

func registerAuthRoutes(router chi.Router, store *auth.Store) {
	limiter := newLimiter(10, time.Minute)
	router.Get("/setup/status", setupStatus(store))
	router.With(limiter.middleware).Post("/setup", setup(store))
	router.With(limiter.middleware).Post("/auth/login", login(store))
}

func registerSessionRoutes(router chi.Router, store *auth.Store) {
	router.Post("/auth/logout", logout(store))
	router.Get("/auth/me", me)
}

func setupStatus(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		available, err := store.SetupAvailable(r.Context())
		writeResult(w, map[string]bool{"available": available}, err)
	}
}

func setup(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			auth.Credentials
			BootstrapToken string `json:"bootstrap_token"`
		}
		if !decode(w, r, &request) {
			return
		}
		session, err := store.Bootstrap(r.Context(), request.BootstrapToken, request.Credentials)
		switch {
		case errors.Is(err, auth.ErrBootstrapClosed):
			http.NotFound(w, r)
			return
		case errors.Is(err, auth.ErrBootstrapNotConfigured):
			http.Error(w, "setup unavailable", http.StatusServiceUnavailable)
			return
		case errors.Is(err, auth.ErrInvalidBootstrapToken):
			http.Error(w, "setup unavailable", http.StatusUnauthorized)
			return
		case errors.Is(err, auth.ErrInvalid):
			http.Error(w, "invalid account", http.StatusBadRequest)
			return
		case err != nil:
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		store.SetCookie(w, session)
		writeJSON(w, http.StatusCreated, session)
	}
}

func login(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var credentials auth.Credentials
		if !decode(w, r, &credentials) {
			return
		}
		session, err := store.Login(r.Context(), credentials)
		if errors.Is(err, auth.ErrInvalidCredentials) {
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		store.SetCookie(w, session)
		writeJSON(w, http.StatusOK, session)
	}
}

func logout(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := store.Logout(r.Context(), auth.RequestToken(r)); err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		store.ClearCookie(w)
		w.WriteHeader(http.StatusNoContent)
	}
}

func me(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

type limiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	attempt map[string]attempt
}

type attempt struct {
	start time.Time
	count int
}

func newLimiter(limit int, window time.Duration) *limiter {
	return &limiter{limit: limit, window: window, attempt: make(map[string]attempt)}
}

func (l *limiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		key := r.URL.Path + "\x00" + host
		now := time.Now()
		l.mu.Lock()
		current := l.attempt[key]
		if current.start.IsZero() || now.Sub(current.start) >= l.window {
			current = attempt{start: now}
		}
		current.count++
		l.attempt[key] = current
		allowed := current.count <= l.limit
		l.mu.Unlock()
		if !allowed {
			http.Error(w, "too many attempts", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
