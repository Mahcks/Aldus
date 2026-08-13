package koreader

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/position"
)

func TestProtocolExactProgressAndStaleRejection(t *testing.T) {
	db, err := database.Open(context.Background(), filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	store := position.New(db)
	if err := store.SeedFixture(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('reader-id','reader','reader','Reader','test-only',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('fixture-library','reader-id','reader','2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	handler := Handler(position.New(db), Credentials{User: "reader", Key: "key"})

	push := koRequest(handler, http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"/body/DocFragment[1]/body/p[2].0","percentage":0.5,"device":"Kobo","device_id":"a"}`)
	if push.Code != http.StatusOK {
		t.Fatalf("push = %d %s", push.Code, push.Body.String())
	}
	pull := koRequest(handler, http.MethodGet, "/syncs/progress/fixture-koreader-document", "")
	if pull.Code != http.StatusOK || !strings.Contains(pull.Body.String(), `p[2].0`) {
		t.Fatalf("pull = %d %s", pull.Code, pull.Body.String())
	}
	stale := koRequest(handler, http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"/body/DocFragment[1]/body/p[1].0","percentage":0.1,"device":"Kobo","device_id":"b"}`)
	if stale.Code != http.StatusAccepted || !strings.Contains(stale.Body.String(), `"conflict":true`) {
		t.Fatalf("stale push = %d %s", stale.Code, stale.Body.String())
	}
	progress, err := store.Progress(context.Background(), "reader-id", "fixture-work")
	if err != nil || progress.SegmentID != "s0002" {
		t.Fatalf("canonical progress = %#v, %v", progress, err)
	}
}

func koRequest(handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Accept", "application/vnd.koreader.v1+json")
	request.Header.Set("x-auth-user", "reader")
	request.Header.Set("x-auth-key", "key")
	handler.ServeHTTP(recorder, request)
	return recorder
}
