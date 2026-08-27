package koreader

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/position"
)

func TestProtocolExactProgressSupportsRereading(t *testing.T) {
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
	handler := Handler(position.New(db), nil, Credentials{User: "reader", Key: "key"})

	push := koRequest(handler, http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"/body/DocFragment[1]/body/p[2].0","percentage":0.5,"device":"Kobo","device_id":"a"}`)
	if push.Code != http.StatusOK {
		t.Fatalf("push = %d %s", push.Code, push.Body.String())
	}
	pull := koRequest(handler, http.MethodGet, "/syncs/progress/fixture-koreader-document", "")
	if pull.Code != http.StatusOK || !strings.Contains(pull.Body.String(), `p[2].0`) {
		t.Fatalf("pull = %d %s", pull.Code, pull.Body.String())
	}
	backward := koRequest(handler, http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"/body/DocFragment[1]/body/p[1].0","percentage":0.1,"device":"Kobo","device_id":"b"}`)
	if backward.Code != http.StatusOK {
		t.Fatalf("backward push = %d %s", backward.Code, backward.Body.String())
	}
	progress, err := store.Progress(context.Background(), "reader-id", "fixture-work")
	if err != nil || progress.SegmentID != "s0001" {
		t.Fatalf("canonical progress = %#v, %v", progress, err)
	}
	raw := position.MarshalKOReaderParagraph(position.EPUBParagraph{KOReaderFragment: 1, KOReaderNodes: []position.KOReaderTextNode{{Path: "html[1]/body[1]/p[1]/text()[1]", Text: "01234567890123456789"}}})
	if _, err := db.Exec(`UPDATE alignment_segments SET koreader_locator=? WHERE alignment_id='fixture-alignment' AND id='s0001'`, raw); err != nil {
		t.Fatal(err)
	}
	for _, xpointer := range []string{"/body/DocFragment[1]/body/p/text().0", "/body/DocFragment[1]/body/p/text().10"} {
		response := koRequest(handler, http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"`+xpointer+`","percentage":0.1,"device":"Kobo"}`)
		if response.Code != http.StatusOK {
			t.Fatalf("within-segment push = %d %s", response.Code, response.Body.String())
		}
	}
	progress, err = store.Progress(context.Background(), "reader-id", "fixture-work")
	if err != nil || progress.Offset < 400_000 {
		t.Fatalf("within-segment progress = %#v, %v", progress, err)
	}
	if _, err := store.UpdateProgress(context.Background(), "reader-id", "fixture-work", position.FixtureAlignmentID, position.Update{
		SegmentID: "s0003", ExpectedRevision: progress.Revision, SourceDevice: "web",
	}); err != nil {
		t.Fatal(err)
	}
	webPull := koRequest(handler, http.MethodGet, "/syncs/progress/fixture-koreader-document", "")
	if webPull.Code != http.StatusOK || !strings.Contains(webPull.Body.String(), `p[3].0`) || !strings.Contains(webPull.Body.String(), `"device":"web"`) {
		t.Fatalf("web to KOReader pull = %d %s", webPull.Code, webPull.Body.String())
	}
}

func TestReaderCredentialsKeepProgressIsolated(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	positions := position.New(db)
	if err := positions.SeedFixture(ctx); err != nil {
		t.Fatal(err)
	}
	accounts, _ := auth.New(db, auth.Options{})
	admin, _ := accounts.Setup(ctx, auth.Credentials{Username: "admin", Password: "a-secure-admin-password"})
	alice, _, _ := accounts.CreateUser(ctx, admin.User, auth.Credentials{Username: "alice", Password: "a-secure-alice-password"}, false)
	bob, _, _ := accounts.CreateUser(ctx, admin.User, auth.Credentials{Username: "bob", Password: "a-secure-bob-password"}, false)
	for _, user := range []auth.User{alice, bob} {
		if err := catalog.New(db).SetMember(ctx, admin.User, "fixture-library", user.ID, "reader"); err != nil {
			t.Fatal(err)
		}
	}
	aliceCredential, _ := accounts.CreateReaderCredential(ctx, alice, "Alice's Kobo")
	bobCredential, _ := accounts.CreateReaderCredential(ctx, bob, "Bob's Kobo")
	handler := Handler(positions, accounts, Credentials{})

	alicePush := koRequestAs(handler, alice.Username, syncKey(aliceCredential.Secret), http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"/body/DocFragment[1]/body/p[2].0","percentage":0.5,"device":"Kobo"}`)
	bobPush := koRequestAs(handler, bob.Username, syncKey(bobCredential.Secret), http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"/body/DocFragment[1]/body/p[1].0","percentage":0.1,"device":"Kobo"}`)
	if alicePush.Code != http.StatusOK || bobPush.Code != http.StatusOK {
		t.Fatalf("pushes = %d %d", alicePush.Code, bobPush.Code)
	}
	alicePull := koRequestAs(handler, alice.Username, syncKey(aliceCredential.Secret), http.MethodGet, "/syncs/progress/fixture-koreader-document", "")
	bobPull := koRequestAs(handler, bob.Username, syncKey(bobCredential.Secret), http.MethodGet, "/syncs/progress/fixture-koreader-document", "")
	if !strings.Contains(alicePull.Body.String(), `p[2].0`) || !strings.Contains(bobPull.Body.String(), `p[1].0`) {
		t.Fatalf("pulls = %s / %s", alicePull.Body.String(), bobPull.Body.String())
	}
	if denied := koRequestAs(handler, alice.Username, syncKey(bobCredential.Secret), http.MethodGet, "/users/auth", ""); denied.Code != http.StatusUnauthorized {
		t.Fatalf("cross-user credential = %d", denied.Code)
	}
}

func syncKey(secret string) string {
	value := md5.Sum([]byte(secret))
	return hex.EncodeToString(value[:])
}

func koRequest(handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	return koRequestAs(handler, "reader", "key", method, target, body)
}

func koRequestAs(handler http.Handler, username, key, method, target, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Accept", "application/vnd.koreader.v1+json")
	request.Header.Set("x-auth-user", username)
	request.Header.Set("x-auth-key", key)
	handler.ServeHTTP(recorder, request)
	return recorder
}
