package v1

import (
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/api/contracts"
	"github.com/mahcks/aldus/server/internal/auth"
)

func registerAuthRoutes(router chi.Router, store *auth.Store, trustProxyHeaders bool) {
	limiter := newLimiter(10, time.Minute, trustProxyHeaders)
	demoLimiter := newLimiter(5, time.Hour, trustProxyHeaders)
	pairingLimiter := newLimiter(5, time.Minute, trustProxyHeaders)
	router.Get("/setup/status", setupStatus(store))
	router.With(limiter.middleware).Post("/setup", setup(store))
	router.With(limiter.middleware).Post("/auth/login", login(store))
	router.With(demoLimiter.middleware).Post("/auth/demo", demoLogin(store))
	router.With(pairingLimiter.middleware).Post("/auth/demo/pair", redeemDemoPairing(store))
}

func redeemDemoPairing(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contracts.DemoPairingRequest
		if !decode(w, r, &request) {
			return
		}
		session, err := store.RedeemDemoPairingCode(r.Context(), request.Code)
		if errors.Is(err, auth.ErrInvalidPairingCode) {
			http.Error(w, "That pairing code is invalid, expired, or already used.", http.StatusUnauthorized)
			return
		}
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		store.SetCookie(w, session)
		writeJSON(w, http.StatusOK, sessionDTO(session))
	}
}

func registerSessionRoutes(router chi.Router, store *auth.Store) {
	router.Post("/auth/logout", logout(store))
	router.Post("/auth/logout-all", logoutAll(store))
	router.Post("/auth/claim", claimAccount(store))
	router.Get("/auth/me", me)
	router.Patch("/auth/me", updateProfile(store))
	router.Put("/auth/me/password", changePassword(store))
	router.Delete("/auth/me", deleteCurrentUser(store))
}

func claimAccount(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := auth.UserFromContext(r.Context())
		var request contracts.ClaimAccountRequest
		if !decode(w, r, &request) {
			return
		}
		if request.Password != request.PasswordConfirmation {
			http.Error(w, "passwords do not match", http.StatusBadRequest)
			return
		}
		session, err := store.ClaimAccount(r.Context(), user, auth.Credentials{Username: request.Username, DisplayName: request.DisplayName, Password: request.Password})
		switch {
		case errors.Is(err, auth.ErrUsernameTaken):
			http.Error(w, "username already exists", http.StatusConflict)
		case errors.Is(err, auth.ErrInvalid):
			http.Error(w, "invalid account", http.StatusBadRequest)
		case err != nil:
			http.Error(w, "internal server error", http.StatusInternalServerError)
		default:
			w.Header().Set("Cache-Control", "no-store")
			store.SetCookie(w, session)
			writeJSON(w, http.StatusOK, sessionDTO(session))
		}
	}
}

func updateProfile(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := auth.UserFromContext(r.Context())
		var request contracts.UpdateProfileRequest
		if !decode(w, r, &request) {
			return
		}
		updated, err := store.UpdateDisplayName(r.Context(), user, request.DisplayName)
		if errors.Is(err, auth.ErrInvalid) {
			http.Error(w, "invalid profile", http.StatusBadRequest)
			return
		}
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, userDTO(updated))
	}
}

func changePassword(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := auth.UserFromContext(r.Context())
		var request contracts.ChangePasswordRequest
		if !decode(w, r, &request) {
			return
		}
		if request.Password != request.PasswordConfirmation {
			http.Error(w, "passwords do not match", http.StatusBadRequest)
			return
		}
		session, err := store.ChangePassword(r.Context(), user, request.CurrentPassword, request.Password)
		switch {
		case errors.Is(err, auth.ErrInvalidCredentials):
			http.Error(w, "current password is incorrect", http.StatusUnauthorized)
		case errors.Is(err, auth.ErrInvalid), errors.Is(err, auth.ErrCredentialsRequired):
			http.Error(w, "invalid password", http.StatusBadRequest)
		case err != nil:
			http.Error(w, "internal server error", http.StatusInternalServerError)
		default:
			w.Header().Set("Cache-Control", "no-store")
			store.SetCookie(w, session)
			writeJSON(w, http.StatusOK, sessionDTO(session))
		}
	}
}

func deleteCurrentUser(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := auth.UserFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var request contracts.DeleteAccountRequest
		if !decode(w, r, &request) {
			return
		}
		err := store.DeleteCurrentUser(r.Context(), user, request.Password)
		switch {
		case errors.Is(err, auth.ErrLastAdmin):
			http.Error(w, "Create another administrator before deleting this account.", http.StatusConflict)
		case errors.Is(err, auth.ErrLastOwner):
			http.Error(w, "Add another enabled owner to each library before deleting this account.", http.StatusConflict)
		case errors.Is(err, auth.ErrUnauthenticated):
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		case errors.Is(err, auth.ErrInvalidCredentials):
			http.Error(w, "current password is incorrect", http.StatusUnauthorized)
		case err != nil:
			http.Error(w, "internal server error", http.StatusInternalServerError)
		default:
			store.ClearCookie(w)
			w.WriteHeader(http.StatusNoContent)
		}
	}
}

func setupStatus(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		available, err := store.SetupAvailable(r.Context())
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		demoAvailable, err := store.DemoReady(r.Context())
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, contracts.SetupStatus{Available: available, DemoAvailable: demoAvailable})
	}
}

func demoLogin(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := store.CreateDemoSession(r.Context())
		switch {
		case errors.Is(err, auth.ErrDemoDisabled):
			http.NotFound(w, r)
			return
		case errors.Is(err, auth.ErrDemoCapacity):
			http.Error(w, "The demo is busy. Please try again later.", http.StatusServiceUnavailable)
			return
		case err != nil:
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		store.SetCookie(w, session)
		writeJSON(w, http.StatusCreated, sessionDTO(session))
	}
}

func setup(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contracts.SetupRequest
		if !decode(w, r, &request) {
			return
		}
		if request.Password != request.PasswordConfirmation {
			http.Error(w, "passwords do not match", http.StatusBadRequest)
			return
		}
		session, err := store.Setup(r.Context(), auth.Credentials{Username: request.Username, Password: request.Password, DisplayName: request.DisplayName})
		switch {
		case errors.Is(err, auth.ErrSetupClosed):
			http.NotFound(w, r)
			return
		case errors.Is(err, auth.ErrInvalid):
			http.Error(w, "invalid account", http.StatusBadRequest)
			return
		case err != nil:
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		store.SetCookie(w, session)
		writeJSON(w, http.StatusCreated, sessionDTO(session))
	}
}

func login(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contracts.LoginRequest
		if !decode(w, r, &request) {
			return
		}
		session, err := store.Login(r.Context(), auth.Credentials{Username: request.Username, Password: request.Password})
		if errors.Is(err, auth.ErrInvalidCredentials) {
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		store.SetCookie(w, session)
		writeJSON(w, http.StatusOK, sessionDTO(session))
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

func logoutAll(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := auth.UserFromContext(r.Context())
		if err := store.RevokeAllSessions(r.Context(), user); err != nil {
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
	writeJSON(w, http.StatusOK, userDTO(user))
}

type limiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	proxy   bool
	attempt map[string]attempt
}

type attempt struct {
	start time.Time
	count int
}

func newLimiter(limit int, window time.Duration, trustProxyHeaders bool) *limiter {
	return &limiter{limit: limit, window: window, proxy: trustProxyHeaders, attempt: make(map[string]attempt)}
}

func (l *limiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		if l.proxy {
			forwarded := strings.TrimSpace(r.Header.Get("Fly-Client-IP"))
			if forwarded == "" {
				forwarded = strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0])
			}
			if net.ParseIP(forwarded) != nil {
				host = forwarded
			}
		}
		path := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/v1"), "/api")
		key := path + "\x00" + host
		now := time.Now()
		l.mu.Lock()
		for key, value := range l.attempt {
			if now.Sub(value.start) >= l.window {
				delete(l.attempt, key)
			}
		}
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
