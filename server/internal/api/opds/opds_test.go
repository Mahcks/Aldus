package opds

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
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
	reader, _, _ := accounts.CreateUser(ctx, admin.User, auth.Credentials{Username: "reader", Password: "a-secure-reader-password"}, false, "")
	outsider, _, _ := accounts.CreateUser(ctx, admin.User, auth.Credentials{Username: "outsider", Password: "a-secure-outsider-password"}, false, "")
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
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err := store.UploadCover(ctx, admin.User, work.ID, bytes.NewReader(png)); err != nil {
		t.Fatal(err)
	}
	covers, err := store.Covers(ctx, admin.User, work.ID)
	if err != nil || len(covers) != 1 {
		t.Fatalf("covers = %#v, %v", covers, err)
	}
	readerCredential, _ := accounts.CreateReaderCredential(ctx, reader, "Kobo")
	outsiderCredential, _ := accounts.CreateReaderCredential(ctx, outsider, "Kobo")
	handler := Handler(Dependencies{Auth: accounts, Catalog: store, Ingest: mediaStore})

	readerFeed := opdsRequest(handler, reader.Username, readerCredential.Secret, "/")
	if readerFeed.Code != http.StatusOK || !strings.Contains(readerFeed.Body.String(), "Alice") || !strings.Contains(readerFeed.Body.String(), media.ID) || !strings.Contains(readerFeed.Body.String(), "<name>Aldus</name>") || !strings.Contains(readerFeed.Body.String(), "/opds/covers/") {
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
	mediaHead := opdsRequestMethod(handler, reader.Username, readerCredential.Secret, http.MethodHead, "/media/"+media.ID)
	if mediaHead.Code != http.StatusOK || mediaHead.Body.Len() != 0 || !strings.Contains(mediaHead.Header().Get("Content-Disposition"), "alice.epub") || mediaHead.Header().Get("Content-Length") == "" {
		t.Fatalf("media HEAD = %d %#v %q", mediaHead.Code, mediaHead.Header(), mediaHead.Body.String())
	}
	feedHead := opdsRequestMethod(handler, reader.Username, readerCredential.Secret, http.MethodHead, "/")
	if feedHead.Code != http.StatusOK || feedHead.Body.Len() != 0 || feedHead.Header().Get("Last-Modified") == "" {
		t.Fatalf("feed HEAD = %d %#v %q", feedHead.Code, feedHead.Header(), feedHead.Body.String())
	}
	cover := opdsRequest(handler, reader.Username, readerCredential.Secret, "/covers/"+covers[0].ID)
	if cover.Code != http.StatusOK || cover.Header().Get("Content-Type") != "image/png" || !bytes.Equal(cover.Body.Bytes(), png) {
		t.Fatalf("cover = %d %#v", cover.Code, cover.Header())
	}
	searchDescription := opdsRequest(handler, reader.Username, readerCredential.Secret, "/search.xml")
	if searchDescription.Code != http.StatusOK || !strings.Contains(searchDescription.Body.String(), "{searchTerms}") {
		t.Fatalf("search description = %d %s", searchDescription.Code, searchDescription.Body.String())
	}
	missingSearch := opdsRequest(handler, reader.Username, readerCredential.Secret, "/?q=missing")
	if missingSearch.Code != http.StatusOK || strings.Contains(missingSearch.Body.String(), "Alice") {
		t.Fatalf("missing search = %d %s", missingSearch.Code, missingSearch.Body.String())
	}

	for i := range 50 {
		item, err := store.CreateWork(ctx, admin.User, library.ID, fmt.Sprintf("Book %02d", i), "Author")
		if err != nil {
			t.Fatal(err)
		}
		representation, err := store.CreateRepresentation(ctx, admin.User, item.ID, "epub", "EPUB")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO media(id,representation_id,kind,path,sha256,created_at,original_filename,size_bytes) VALUES(?,?,'epub',?,?,?,'book.epub',1)`, fmt.Sprintf("media-%02d", i), representation.ID, fmt.Sprintf("book-%02d.epub", i), fmt.Sprintf("%064d", i+1), fmt.Sprintf("2026-01-01T00:%02d:00Z", i)); err != nil {
			t.Fatal(err)
		}
	}
	firstPage := opdsRequest(handler, reader.Username, readerCredential.Secret, "/")
	if firstPage.Code != http.StatusOK || !strings.Contains(firstPage.Body.String(), `rel="next"`) || !strings.Contains(firstPage.Body.String(), `page=2`) {
		t.Fatalf("first page = %d %s", firstPage.Code, firstPage.Body.String())
	}
	secondPage := opdsRequest(handler, reader.Username, readerCredential.Secret, "/?page=2")
	if secondPage.Code != http.StatusOK || strings.Contains(secondPage.Body.String(), `rel="next"`) {
		t.Fatalf("second page = %d %s", secondPage.Code, secondPage.Body.String())
	}
}

func opdsRequest(handler http.Handler, username, password, target string) *httptest.ResponseRecorder {
	return opdsRequestMethod(handler, username, password, http.MethodGet, target)
}

func opdsRequestMethod(handler http.Handler, username, password, method, target string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, target, nil)
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
