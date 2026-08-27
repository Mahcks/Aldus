package ingest

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
)

type setup struct {
	store                                      *Store
	catalog                                    *catalog.Store
	accounts                                   *auth.Store
	admin, editor, reader, outsider            auth.User
	libraryID, otherLibraryID, epubID, audioID string
	root                                       string
}

func testSetup(t *testing.T) *setup {
	t.Helper()
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
	makeUser := func(name string) auth.User {
		u, _, err := accounts.CreateUser(ctx, session.User, auth.Credentials{Username: name, Password: "a-secure-user-password"}, false)
		if err != nil {
			t.Fatal(err)
		}
		return u
	}
	editor, reader, outsider := makeUser("editor"), makeUser("reader"), makeUser("outsider")
	cat := catalog.New(db)
	library, err := cat.CreateLibrary(ctx, session.User, "Library")
	if err != nil {
		t.Fatal(err)
	}
	other, err := cat.CreateLibrary(ctx, outsider, "Other")
	if err != nil {
		t.Fatal(err)
	}
	if err := cat.SetMember(ctx, session.User, library.ID, editor.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	if err := cat.SetMember(ctx, session.User, library.ID, reader.ID, "reader"); err != nil {
		t.Fatal(err)
	}
	work, err := cat.CreateWork(ctx, session.User, library.ID, "Alice", "")
	if err != nil {
		t.Fatal(err)
	}
	epub, err := cat.CreateRepresentation(ctx, session.User, work.ID, "epub", "EPUB")
	if err != nil {
		t.Fatal(err)
	}
	audio, err := cat.CreateRepresentation(ctx, session.User, work.ID, "audio", "Audio")
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	store, err := New(db, Options{Root: root, MaxBytes: 1 << 20, Probe: func(_ context.Context, path string) error {
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if !bytes.HasPrefix(data, []byte("ID3")) {
			return errors.New("not audio")
		}
		return nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	return &setup{store: store, catalog: cat, accounts: accounts, admin: session.User, editor: editor, reader: reader, outsider: outsider, libraryID: library.ID, otherLibraryID: other.ID, epubID: epub.ID, audioID: audio.ID, root: root}
}

func TestEPUBUploadImmutableAndAuthorized(t *testing.T) {
	s := testSetup(t)
	ctx := context.Background()
	content := validEPUB(t, "chapter one")
	media, err := s.store.Upload(ctx, s.admin, s.libraryID, s.epubID, "../../evil.epub", bytes.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(content)
	if media.SHA256 != hex.EncodeToString(sum[:]) || media.OriginalFilename != "evil.epub" || media.SizeBytes != int64(len(content)) {
		t.Fatalf("media=%#v", media)
	}
	if _, err := os.Stat(filepath.Join(s.root, "media", media.SHA256[:2], media.SHA256+".epub")); err != nil {
		t.Fatal(err)
	}
	duplicate, err := s.store.Upload(ctx, s.editor, s.libraryID, s.epubID, "again.epub", bytes.NewReader(content))
	if err != nil || duplicate.ID != media.ID {
		t.Fatalf("duplicate=%#v, %v", duplicate, err)
	}
	changed, err := s.store.Upload(ctx, s.editor, s.libraryID, s.epubID, "changed.epub", bytes.NewReader(validEPUB(t, "chapter two")))
	if err != nil || changed.ID == media.ID {
		t.Fatalf("changed=%#v, %v", changed, err)
	}
	listed, err := s.store.Media(ctx, s.reader, s.libraryID, s.epubID, 50, 0)
	if err != nil || len(listed) != 2 {
		t.Fatalf("listed=%#v, %v", listed, err)
	}
	for _, test := range []struct {
		name        string
		user        auth.User
		library, id string
	}{{"reader", s.reader, s.libraryID, s.epubID}, {"cross library", s.outsider, s.libraryID, s.epubID}, {"wrong library", s.admin, s.otherLibraryID, s.epubID}, {"missing", s.admin, s.libraryID, "missing"}} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := s.store.Upload(ctx, test.user, test.library, test.id, "book.epub", bytes.NewReader(content)); !errors.Is(err, ErrNotFound) {
				t.Fatalf("error=%v", err)
			}
		})
	}
}

func TestValidationLimitsAndCleanup(t *testing.T) {
	s := testSetup(t)
	ctx := context.Background()
	if _, err := s.store.Upload(ctx, s.admin, s.libraryID, s.epubID, "bad.epub", strings.NewReader("not a zip")); !errors.Is(err, ErrInvalid) {
		t.Fatalf("corrupt=%v", err)
	}
	if _, err := s.store.Upload(ctx, s.admin, s.libraryID, s.epubID, "bomb.epub", bytes.NewReader(zipBomb(t, (1<<20)+1))); !errors.Is(err, ErrInvalid) {
		t.Fatalf("zip bomb=%v", err)
	}
	if _, err := s.store.Upload(ctx, s.admin, s.libraryID, s.audioID, "too-big.mp3", bytes.NewReader(make([]byte, (1<<20)+1))); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("large=%v", err)
	}
	if _, err := s.store.Upload(ctx, s.admin, s.libraryID, s.audioID, "book.mp3", strings.NewReader("ID3audio")); err != nil {
		t.Fatalf("audio=%v", err)
	}
	if _, err := s.store.Upload(ctx, s.admin, s.libraryID, s.audioID, "book.epub", bytes.NewReader(validEPUB(t, "text"))); !errors.Is(err, ErrInvalid) {
		t.Fatalf("incompatible media = %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(s.root, "staging"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("staging=%v, %v", entries, err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := s.store.Upload(canceled, s.admin, s.libraryID, s.audioID, "cancel.mp3", strings.NewReader("audio")); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel=%v", err)
	}
	if _, err := s.store.Upload(ctx, s.admin, s.libraryID, s.audioID, "interrupted.mp3", errorReader{}); err == nil {
		t.Fatal("interrupted upload succeeded")
	}
	entries, _ = os.ReadDir(filepath.Join(s.root, "staging"))
	if len(entries) != 0 {
		t.Fatalf("interrupted staging remains: %v", entries)
	}
}

func TestAudioProbeFailureAndStartupCleanup(t *testing.T) {
	s := testSetup(t)
	orphan := filepath.Join(s.root, "staging", "orphan")
	if err := os.WriteFile(orphan, []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := New(s.store.db, Options{Root: s.root, MaxBytes: 1 << 20, Probe: func(context.Context, string) error { return errors.New("no audio") }})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(orphan); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("orphan remains: %v", err)
	}
	if _, err := store.Upload(context.Background(), s.admin, s.libraryID, s.audioID, "bad.mp3", strings.NewReader("bad")); !errors.Is(err, ErrInvalid) {
		t.Fatalf("probe failure=%v", err)
	}
}

func TestDatabaseFailureRemovesFinalFile(t *testing.T) {
	s := testSetup(t)
	if _, err := s.store.db.Exec(`CREATE TRIGGER reject_media BEFORE INSERT ON media BEGIN SELECT RAISE(FAIL,'rejected'); END`); err != nil {
		t.Fatal(err)
	}
	content := validEPUB(t, "failure")
	sum := sha256.Sum256(content)
	digest := hex.EncodeToString(sum[:])
	if _, err := s.store.Upload(context.Background(), s.admin, s.libraryID, s.epubID, "book.epub", bytes.NewReader(content)); err == nil {
		t.Fatal("database failure succeeded")
	}
	if _, err := os.Stat(filepath.Join(s.root, "media", digest[:2], digest+".epub")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("final file remains: %v", err)
	}
	entries, _ := os.ReadDir(filepath.Join(s.root, "staging"))
	if len(entries) != 0 {
		t.Fatalf("staging remains: %v", entries)
	}
}

func TestNewRevisionMarksAlignmentStale(t *testing.T) {
	s := testSetup(t)
	ctx := context.Background()
	epub, err := s.store.Upload(ctx, s.admin, s.libraryID, s.epubID, "one.epub", bytes.NewReader(validEPUB(t, "one")))
	if err != nil {
		t.Fatal(err)
	}
	audio, err := s.store.Upload(ctx, s.admin, s.libraryID, s.audioID, "audio.mp3", strings.NewReader("ID3audio"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.store.db.Exec(`INSERT INTO alignments(id,epub_media_id,audio_media_id,revision,state,created_at) VALUES('alignment',?,?,1,'ready','2026-01-01T00:00:00Z')`, epub.ID, audio.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.store.db.Exec(`INSERT INTO alignment_inputs(alignment_id,media_id,role) VALUES('alignment',?,'epub'),('alignment',?,'audio')`, epub.ID, audio.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.store.db.Exec(`INSERT INTO alignment_jobs(id,alignment_id,epub_media_id,audio_media_id,state,worker_version,model,created_at) VALUES('job','alignment',?,?,'ready','whisperx 3.8.6','base.en','2026-01-01T00:00:00Z')`, epub.ID, audio.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.store.Upload(ctx, s.admin, s.libraryID, s.epubID, "two.epub", bytes.NewReader(validEPUB(t, "two"))); err != nil {
		t.Fatal(err)
	}
	var state string
	if err := s.store.db.QueryRow(`SELECT state FROM alignments WHERE id='alignment'`).Scan(&state); err != nil || state != "stale" {
		t.Fatalf("state=%q, %v", state, err)
	}
	if err := s.store.db.QueryRow(`SELECT state FROM alignment_jobs WHERE id='job'`).Scan(&state); err != nil || state != "stale" {
		t.Fatalf("job state=%q, %v", state, err)
	}
}

func validEPUB(t *testing.T, text string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	write := func(name, value string) {
		entry, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(entry, value); err != nil {
			t.Fatal(err)
		}
	}
	write("mimetype", "application/epub+zip")
	write("META-INF/container.xml", `<?xml version="1.0"?><container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>`)
	write("book.opf", `<?xml version="1.0"?><package><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>`)
	write("chapter.xhtml", text)
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

type errorReader struct{ sent bool }

func (r errorReader) Read(p []byte) (int, error) {
	if !r.sent {
		copy(p, "ID3")
		return 3, errors.New("interrupted")
	}
	return 0, errors.New("interrupted")
}

func zipBomb(t *testing.T, size int) []byte {
	t.Helper()
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	entry, err := archive.Create("large")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write(bytes.Repeat([]byte("a"), size)); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
