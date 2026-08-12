package v1

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/position"
)

func TestResolveAudioAndUpdateProgress(t *testing.T) {
	store, err := position.Open(context.Background(), filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.SeedFixture(context.Background()); err != nil {
		t.Fatal(err)
	}
	handler := Handler(store)

	response := request(t, handler, http.MethodPost, "/alignments/fixture-alignment/resolve/audio", `{"resource":"fixture/book.m4b","timestamp_ms":4420}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"segment_id":"s0002"`) || !strings.Contains(response.Body.String(), `"offset":350000`) {
		t.Fatalf("resolve response = %d %s", response.Code, response.Body.String())
	}
	response = request(t, handler, http.MethodPut, "/alignments/fixture-alignment/progress", `{"segment_id":"s0002","offset":350000,"expected_revision":0,"source_device":"web"}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"revision":1`) {
		t.Fatalf("update response = %d %s", response.Code, response.Body.String())
	}
}

func TestProgressConflictContract(t *testing.T) {
	store, err := position.Open(context.Background(), filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.SeedFixture(context.Background()); err != nil {
		t.Fatal(err)
	}
	handler := Handler(store)
	first := request(t, handler, http.MethodPut, "/alignments/fixture-alignment/progress", `{"segment_id":"s0001","offset":0,"expected_revision":0,"source_device":"web"}`)
	if first.Code != http.StatusOK {
		t.Fatalf("first update = %d %s", first.Code, first.Body.String())
	}
	conflict := request(t, handler, http.MethodPut, "/alignments/fixture-alignment/progress", `{"segment_id":"s0002","offset":0,"expected_revision":0,"source_device":"other"}`)
	if conflict.Code != http.StatusConflict {
		t.Fatalf("conflict = %d %s", conflict.Code, conflict.Body.String())
	}
	const want = `{"alignment_id":"fixture-alignment","segment_id":"s0001","offset":0,"revision":1,`
	if !strings.HasPrefix(conflict.Body.String(), want) {
		t.Fatalf("conflict body = %s, want prefix %s", conflict.Body.String(), want)
	}
}

func request(t *testing.T, handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(recorder, request)
	return recorder
}
