package api

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequestLoggerRecordsHTTPSeverityAndDiagnosis(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	handler := requestLogger(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "bad request", http.StatusBadRequest)
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/test?secret=hidden", nil))
	logged := output.String()
	requestID := recorder.Header().Get("X-Request-ID")
	if recorder.Code != http.StatusBadRequest || len(requestID) != 16 || !strings.Contains(logged, "level=WARN") || !strings.Contains(logged, "request_id="+requestID) || !strings.Contains(logged, "method=POST") || !strings.Contains(logged, "path=/api/test") || strings.Contains(logged, "secret") {
		t.Fatalf("response=%d log=%q", recorder.Code, logged)
	}
}
