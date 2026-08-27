package api

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type failureLimiter struct {
	mu       sync.Mutex
	limit    int
	window   time.Duration
	proxy    bool
	attempts map[string]attempt
}

type attempt struct {
	start time.Time
	count int
}

func newFailureLimiter(limit int, window time.Duration, trustProxyHeaders bool) *failureLimiter {
	return &failureLimiter{limit: limit, window: window, proxy: trustProxyHeaders, attempts: make(map[string]attempt)}
}

func (l *failureLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := l.client(r)
		now := time.Now()
		l.mu.Lock()
		for client, value := range l.attempts {
			if now.Sub(value.start) >= l.window {
				delete(l.attempts, client)
			}
		}
		current := l.attempts[key]
		if current.start.IsZero() || now.Sub(current.start) >= l.window {
			current = attempt{start: now}
		}
		if current.count >= l.limit {
			l.mu.Unlock()
			http.Error(w, "too many attempts", http.StatusTooManyRequests)
			return
		}
		current.count++
		l.attempts[key] = current
		windowStart := current.start
		l.mu.Unlock()

		response := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(response, r)
		if response.status == http.StatusUnauthorized || response.status == http.StatusPaymentRequired {
			return
		}
		l.mu.Lock()
		current = l.attempts[key]
		if current.start.Equal(windowStart) {
			current.count--
			if current.count == 0 {
				delete(l.attempts, key)
			} else {
				l.attempts[key] = current
			}
		}
		l.mu.Unlock()
	})
}

func (l *failureLimiter) client(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if !l.proxy {
		return host
	}
	forwarded := strings.TrimSpace(r.Header.Get("Fly-Client-IP"))
	if forwarded == "" {
		forwarded = strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0])
	}
	if net.ParseIP(forwarded) != nil {
		return forwarded
	}
	return host
}

type statusWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (w *statusWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
