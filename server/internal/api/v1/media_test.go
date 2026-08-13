package v1

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/ingest"
	"github.com/mahcks/aldus/server/internal/position"
)

func TestOpaqueMediaDownloadSupportsRanges(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	accounts, err := auth.New(db, auth.Options{BootstrapToken: "bootstrap-token"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := accounts.Bootstrap(ctx, "bootstrap-token", auth.Credentials{Username: "admin", Password: "a-secure-admin-password"})
	if err != nil {
		t.Fatal(err)
	}
	catalogStore := catalog.New(db)
	library, err := catalogStore.CreateLibrary(ctx, session.User, "Library")
	if err != nil {
		t.Fatal(err)
	}
	work, err := catalogStore.CreateWork(ctx, session.User, library.ID, "Book", "")
	if err != nil {
		t.Fatal(err)
	}
	representation, err := catalogStore.CreateRepresentation(ctx, session.User, work.ID, "audio", "Audio")
	if err != nil {
		t.Fatal(err)
	}
	mediaStore, err := ingest.New(db, ingest.Options{Root: t.TempDir(), MaxBytes: 1024, Probe: func(context.Context, string) error { return nil }})
	if err != nil {
		t.Fatal(err)
	}
	media, err := mediaStore.Upload(ctx, session.User, library.ID, representation.ID, "chapter.mp3", strings.NewReader("0123456789"))
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(position.New(db), accounts, catalogStore, mediaStore, nil)
	request := httptest.NewRequest(http.MethodGet, "/media/"+media.ID, nil)
	request.Header.Set("Authorization", "Bearer "+session.Token)
	request.Header.Set("Range", "bytes=2-5")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "2345" || response.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("range=%d %q %#v", response.Code, response.Body.String(), response.Header())
	}
}
