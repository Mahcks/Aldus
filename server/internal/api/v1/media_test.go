package v1

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/ingest"
	"github.com/mahcks/aldus/server/internal/position"
	"github.com/mahcks/aldus/server/internal/source"
)

func TestOpaqueMediaDownloadSupportsRanges(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	accounts, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	session, err := accounts.Setup(ctx, auth.Credentials{Username: "admin", Password: "a-secure-admin-password"})
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
	handler := Handler(Dependencies{Position: position.New(db), Auth: accounts, Catalog: catalogStore, Ingest: mediaStore})
	request := httptest.NewRequest(http.MethodGet, "/media/"+media.ID, nil)
	request.Header.Set("Authorization", "Bearer "+session.Token)
	request.Header.Set("Range", "bytes=2-5")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "2345" || response.Header().Get("Accept-Ranges") != "bytes" || response.Header().Get("Content-Type") != "audio/mpeg" {
		t.Fatalf("range=%d %q %#v", response.Code, response.Body.String(), response.Header())
	}
}

func TestReferencedMediaDownloadSupportsRangesAndFailsWhenChanged(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	accounts, _ := auth.New(db, auth.Options{})
	session, err := accounts.Setup(ctx, auth.Credentials{Username: "admin", Password: "a-secure-admin-password"})
	if err != nil {
		t.Fatal(err)
	}
	catalogStore := catalog.New(db)
	library, _ := catalogStore.CreateLibrary(ctx, session.User, "Library")
	work, _ := catalogStore.CreateWork(ctx, session.User, library.ID, "Book", "")
	representation, _ := catalogStore.CreateRepresentation(ctx, session.User, work.ID, "audio", "Audio")
	allowed, managed := t.TempDir(), t.TempDir()
	root := filepath.Join(allowed, "books")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	bytes := []byte("0123456789")
	path := filepath.Join(root, "chapter.mp3")
	if err := os.WriteFile(path, bytes, 0o644); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(path)
	sum := sha256.Sum256(bytes)
	hash := hex.EncodeToString(sum[:])
	resolver, _ := source.New(db, source.Options{AllowedRoots: []string{allowed}, ManagedRoot: managed})
	saved, err := resolver.Create(ctx, session.User, library.ID, "Books", root)
	if err != nil {
		t.Fatal(err)
	}
	now := info.ModTime().UTC().Format(time.RFC3339Nano)
	_, err = db.Exec(`INSERT INTO source_entries(id,source_id,relative_path,size_bytes,modified_at,sha256,state,created_at,updated_at) VALUES('entry',?,'chapter.mp3',?,?,?,'registered',?,?);`, saved.ID, len(bytes), now, hash, now, now)
	if err == nil {
		_, err = db.Exec(`INSERT INTO media(id,representation_id,kind,path,sha256,created_at,original_filename,size_bytes,storage_kind,source_entry_id) VALUES('referenced',?,'audio','',?,?,'chapter.mp3',?,'referenced','entry')`, representation.ID, hash, now, len(bytes))
	}
	if err != nil {
		t.Fatal(err)
	}
	mediaStore, _ := ingest.New(db, ingest.Options{Root: managed, MaxBytes: 1024, Resolver: resolver})
	handler := Handler(Dependencies{Position: position.New(db), Auth: accounts, Catalog: catalogStore, Ingest: mediaStore, Sources: resolver})
	roots, _ := resolver.Roots(session.User)
	rootsRequest := httptest.NewRequest(http.MethodGet, "/source-roots", nil)
	rootsRequest.Header.Set("Authorization", "Bearer "+session.Token)
	rootsResponse := httptest.NewRecorder()
	handler.ServeHTTP(rootsResponse, rootsRequest)
	if rootsResponse.Code != http.StatusOK || !strings.Contains(rootsResponse.Body.String(), allowed) {
		t.Fatalf("source roots=%d %s", rootsResponse.Code, rootsResponse.Body.String())
	}
	directoriesRequest := httptest.NewRequest(http.MethodGet, "/source-roots/"+roots[0].ID+"/directories", nil)
	directoriesRequest.Header.Set("Authorization", "Bearer "+session.Token)
	directoriesResponse := httptest.NewRecorder()
	handler.ServeHTTP(directoriesResponse, directoriesRequest)
	if directoriesResponse.Code != http.StatusOK || !strings.Contains(directoriesResponse.Body.String(), `"directories":["books"]`) {
		t.Fatalf("source directories=%d %s", directoriesResponse.Code, directoriesResponse.Body.String())
	}
	invalidRequest := httptest.NewRequest(http.MethodPost, "/libraries/"+library.ID+"/sources", strings.NewReader(`{"name":"Missing","root_path":"/does-not-exist"}`))
	invalidRequest.Header.Set("Authorization", "Bearer "+session.Token)
	invalidRequest.Header.Set("Content-Type", "application/json")
	invalidResponse := httptest.NewRecorder()
	handler.ServeHTTP(invalidResponse, invalidRequest)
	if invalidResponse.Code != http.StatusBadRequest || !strings.Contains(invalidResponse.Body.String(), "does not exist") {
		t.Fatalf("invalid source=%d %s", invalidResponse.Code, invalidResponse.Body.String())
	}
	request := httptest.NewRequest(http.MethodGet, "/media/referenced", nil)
	request.Header.Set("Authorization", "Bearer "+session.Token)
	request.Header.Set("Range", "bytes=2-5")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "2345" {
		t.Fatalf("range=%d %q", response.Code, response.Body.String())
	}
	if err := os.WriteFile(path, []byte("changed"), 0o644); err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	changedRequest := httptest.NewRequest(http.MethodGet, "/media/referenced", nil)
	changedRequest.Header.Set("Authorization", "Bearer "+session.Token)
	handler.ServeHTTP(response, changedRequest)
	if response.Code != http.StatusNotFound {
		t.Fatalf("changed=%d", response.Code)
	}
}
