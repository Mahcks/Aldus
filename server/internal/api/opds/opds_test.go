package opds

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/ingest"
)

func TestCatalogAndDownloadsAreIsolatedByUser(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	accounts, _ := auth.New(db, auth.Options{})
	admin, _ := accounts.Setup(ctx, auth.Credentials{Username: "admin", Password: "a-secure-admin-password"})
	reader, _, _ := accounts.CreateUser(ctx, admin.User, auth.Credentials{Username: "reader", Password: "a-secure-reader-password"}, false)
	outsider, _, _ := accounts.CreateUser(ctx, admin.User, auth.Credentials{Username: "outsider", Password: "a-secure-outsider-password"}, false)
	store := catalog.New(db)
	library, _ := store.CreateLibrary(ctx, admin.User, "Classics")
	_ = store.SetMember(ctx, admin.User, library.ID, reader.ID, "reader")
	work, _ := store.CreateWork(ctx, admin.User, library.ID, "Alice", "Lewis Carroll")
	representation, _ := store.CreateRepresentation(ctx, admin.User, work.ID, "epub", "EPUB")
	mediaStore, _ := ingest.New(db, ingest.Options{Root: t.TempDir(), MaxBytes: 1 << 20})
	media, err := mediaStore.Upload(ctx, admin.User, library.ID, representation.ID, "alice.epub", bytes.NewReader(testEPUB(t)))
	if err != nil {
		t.Fatal(err)
	}
	readerCredential, _ := accounts.CreateReaderCredential(ctx, reader, "Kobo")
	outsiderCredential, _ := accounts.CreateReaderCredential(ctx, outsider, "Kobo")
	handler := Handler(Dependencies{Auth: accounts, Catalog: store, Ingest: mediaStore})

	readerFeed := opdsRequest(handler, reader.Username, readerCredential.Secret, "/")
	if readerFeed.Code != http.StatusOK || !strings.Contains(readerFeed.Body.String(), "Alice") || !strings.Contains(readerFeed.Body.String(), media.ID) {
		t.Fatalf("reader feed = %d %s", readerFeed.Code, readerFeed.Body.String())
	}
	outsiderFeed := opdsRequest(handler, outsider.Username, outsiderCredential.Secret, "/")
	if outsiderFeed.Code != http.StatusOK || strings.Contains(outsiderFeed.Body.String(), "Alice") {
		t.Fatalf("outsider feed = %d %s", outsiderFeed.Code, outsiderFeed.Body.String())
	}
	if response := opdsRequest(handler, outsider.Username, outsiderCredential.Secret, "/media/"+media.ID); response.Code != http.StatusNotFound {
		t.Fatalf("outsider download = %d", response.Code)
	}
	if response := opdsRequest(handler, reader.Username, readerCredential.Secret, "/media/"+media.ID); response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/epub+zip" {
		t.Fatalf("reader download = %d %#v", response.Code, response.Header())
	}
}

func opdsRequest(handler http.Handler, username, password, target string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.SetBasicAuth(username, password)
	handler.ServeHTTP(recorder, request)
	return recorder
}

func testEPUB(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	for name, value := range map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": `<?xml version="1.0"?><container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>`,
		"book.opf":               `<?xml version="1.0"?><package><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
		"chapter.xhtml":          "Alice",
	} {
		entry, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.WriteString(entry, value)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
