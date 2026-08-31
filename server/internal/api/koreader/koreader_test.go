package koreader

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
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

	push := koRequest(handler, http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","metadata":{"filename":"alice.epub","title":"Alice"},"progress":"/body/DocFragment[1]/body/p[2].0","percentage":0.5,"device":"Kobo","device_id":"a"}`)
	if push.Code != http.StatusOK {
		t.Fatalf("push = %d %s", push.Code, push.Body.String())
	}
	pull := koRequest(handler, http.MethodGet, "/syncs/progress/fixture-koreader-document", "")
	if pull.Code != http.StatusOK || !strings.Contains(pull.Body.String(), `p[2].0`) || !strings.Contains(pull.Body.String(), `"device":"Kobo"`) || !strings.Contains(pull.Body.String(), `"device_id":"a"`) {
		t.Fatalf("pull = %d %s", pull.Code, pull.Body.String())
	}
	backward := koRequest(handler, http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"/body/DocFragment[1]/body/p[1].0","percentage":0.1,"device":"Kobo","device_id":"b"}`)
	if backward.Code != http.StatusOK {
		t.Fatalf("backward push = %d %s", backward.Code, backward.Body.String())
	}
	root := koRequest(handler, http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"/body/DocFragment[1].0","percentage":0.1,"device":"Kobo","device_id":"root"}`)
	rootPull := koRequest(handler, http.MethodGet, "/syncs/progress/fixture-koreader-document", "")
	if root.Code != http.StatusOK || !strings.Contains(rootPull.Body.String(), `"progress":"/body/DocFragment[1].0"`) {
		t.Fatalf("exact root round trip = %d %s", root.Code, rootPull.Body.String())
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
		response := koRequest(handler, http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"`+xpointer+`","percentage":0.1,"device":"Kobo","device_id":"within"}`)
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
	alice, _, _ := accounts.CreateUser(ctx, admin.User, auth.Credentials{Username: "alice", Password: "a-secure-alice-password"}, false, "")
	bob, _, _ := accounts.CreateUser(ctx, admin.User, auth.Credentials{Username: "bob", Password: "a-secure-bob-password"}, false, "")
	for _, user := range []auth.User{alice, bob} {
		if err := catalog.New(db).SetMember(ctx, admin.User, "fixture-library", user.ID, "reader"); err != nil {
			t.Fatal(err)
		}
	}
	aliceCredential, _ := accounts.CreateReaderCredential(ctx, alice, "Alice's Kobo")
	bobCredential, _ := accounts.CreateReaderCredential(ctx, bob, "Bob's Kobo")
	handler := Handler(positions, accounts, Credentials{})

	alicePush := koRequestAs(handler, alice.Username, syncKey(aliceCredential.Secret), http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"/body/DocFragment[1]/body/p[2].0","percentage":0.5,"device":"Kobo","device_id":"alice"}`)
	bobPush := koRequestAs(handler, bob.Username, syncKey(bobCredential.Secret), http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"/body/DocFragment[1]/body/p[1].0","percentage":0.1,"device":"Kobo","device_id":"bob"}`)
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

func TestUnalignedEPUBKeepsNativeKOReaderProgress(t *testing.T) {
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
	reader, _ := accounts.Setup(ctx, auth.Credentials{Username: "reader", Password: "a-secure-reader-password"})
	if err := catalog.New(db).SetMember(ctx, reader.User, "fixture-library", reader.User.ID, "owner"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO representations(id,work_id,kind,label,created_at,updated_at) VALUES('unaligned-representation','fixture-work','epub','Other EPUB','2026-01-02','2026-01-02');
		INSERT INTO media(id,representation_id,kind,path,sha256,created_at) VALUES('unaligned-media','unaligned-representation','epub','other.epub','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-01-02');
		INSERT INTO koreader_aliases(document_id,media_id) VALUES('unaligned-document','unaligned-media')`); err != nil {
		t.Fatal(err)
	}
	handler := Handler(positions, accounts, Credentials{})
	credential, _ := accounts.CreateReaderCredential(ctx, reader.User, "Kobo")
	key := syncKey(credential.Secret)
	body := `{"document":"unaligned-document","progress":"/body/DocFragment[30].0","percentage":0.3284,"device":"Kobo Libra","device_id":"libra-1"}`
	push := koRequestAs(handler, reader.User.Username, key, http.MethodPut, "/syncs/progress", body)
	if push.Code != http.StatusOK {
		t.Fatalf("push = %d %s", push.Code, push.Body.String())
	}
	pull := koRequestAs(handler, reader.User.Username, key, http.MethodGet, "/syncs/progress/unaligned-document", "")
	if pull.Code != http.StatusOK || !strings.Contains(pull.Body.String(), `"progress":"/body/DocFragment[30].0"`) || !strings.Contains(pull.Body.String(), `"device_id":"libra-1"`) {
		t.Fatalf("pull = %d %s", pull.Code, pull.Body.String())
	}
	if _, err := positions.Progress(ctx, reader.User.ID, "fixture-work"); !errors.Is(err, position.ErrNotFound) {
		t.Fatalf("unaligned push created canonical progress: %v", err)
	}
}

func TestKOReaderRejectsAmbiguousDocumentIdentity(t *testing.T) {
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
	if _, err := db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('reader-id','reader','reader','Reader','test-only',0,0,'2026-01-01','2026-01-01');
		INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('fixture-library','reader-id','reader','2026-01-01');
		INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('collision-work','fixture-library','Collision','2026-01-01','2026-01-01');
		INSERT INTO representations(id,work_id,kind,label,created_at,updated_at) VALUES('collision-representation','collision-work','epub','EPUB','2026-01-01','2026-01-01');
		INSERT INTO media(id,representation_id,kind,path,sha256,created_at) VALUES('collision-media','collision-representation','epub','collision.epub','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','2026-01-01');
		INSERT INTO koreader_aliases(document_id,media_id) VALUES('fixture-koreader-document','collision-media')`); err != nil {
		t.Fatal(err)
	}
	handler := Handler(positions, nil, Credentials{User: "reader", Key: "key"})
	response := koRequest(handler, http.MethodPut, "/syncs/progress", `{"document":"fixture-koreader-document","progress":"/body/DocFragment[1].0","percentage":0,"device":"Kobo","device_id":"device"}`)
	if response.Code != http.StatusNotFound {
		t.Fatalf("collision = %d %s", response.Code, response.Body.String())
	}
}

func TestConcurrentKOReaderPushesReturnSuccess(t *testing.T) {
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
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('reader-id','reader','reader','Reader','test-only',0,0,'2026-01-01','2026-01-01'); INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('fixture-library','reader-id','reader','2026-01-01')`); err != nil {
		t.Fatal(err)
	}
	handler := Handler(positions, nil, Credentials{User: "reader", Key: "key"})
	start := make(chan struct{})
	statuses := make(chan int, 4)
	var group sync.WaitGroup
	for i, paragraph := range []string{"p[1]", "p[2]", "p[3]", "p[2]"} {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			body := fmt.Sprintf(`{"document":"fixture-koreader-document","progress":"/body/DocFragment[1]/body/%s.0","percentage":0.5,"device":"Kobo","device_id":"device-%d"}`, paragraph, i)
			statuses <- koRequest(handler, http.MethodPut, "/syncs/progress", body).Code
		}()
	}
	close(start)
	group.Wait()
	close(statuses)
	for status := range statuses {
		if status != http.StatusOK {
			t.Fatalf("concurrent push = %d", status)
		}
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
