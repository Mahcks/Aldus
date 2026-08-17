package catalog

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func testCatalog(t *testing.T) (*Store, *auth.Store, auth.User) {
	t.Helper()
	db, err := database.Open(context.Background(), filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	accounts, err := auth.New(db, auth.Options{BootstrapToken: "bootstrap-token"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := accounts.Bootstrap(context.Background(), "bootstrap-token", auth.Credentials{Username: "admin", Password: "a-secure-admin-password"})
	if err != nil {
		t.Fatal(err)
	}
	return New(db), accounts, session.User
}

func createUser(t *testing.T, accounts *auth.Store, admin auth.User, name string) auth.User {
	t.Helper()
	user, err := accounts.CreateUser(context.Background(), admin, auth.Credentials{Username: name, Password: "a-secure-user-password"}, false)
	if err != nil {
		t.Fatal(err)
	}
	return user
}

func TestLibrariesRolesAndIsolation(t *testing.T) {
	ctx := context.Background()
	store, accounts, admin := testCatalog(t)
	editor := createUser(t, accounts, admin, "editor")
	reader := createUser(t, accounts, admin, "reader")
	outsider := createUser(t, accounts, admin, "outsider")
	first, err := store.CreateLibrary(ctx, admin, "First")
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.CreateLibrary(ctx, outsider, "Second")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetMember(ctx, admin, first.ID, editor.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetMember(ctx, admin, first.ID, reader.ID, "reader"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Library(ctx, reader, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Library(ctx, reader, second.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-library get = %v", err)
	}
	if members, err := store.Members(ctx, reader, second.ID); !errors.Is(err, ErrNotFound) || members != nil {
		t.Fatalf("cross-library members = %#v, %v", members, err)
	}
	if _, err := store.CreateWork(ctx, reader, first.ID, "Denied", ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reader create = %v", err)
	}
	work, err := store.CreateWork(ctx, editor, first.ID, "Alice's Adventures in Wonderland", "Lewis Carroll")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Work(ctx, outsider, work.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-library work = %v", err)
	}
	epub, err := store.CreateRepresentation(ctx, editor, work.ID, "epub", "First edition")
	if err != nil {
		t.Fatal(err)
	}
	audio, err := store.CreateRepresentation(ctx, editor, work.ID, "audio", "Narrated edition")
	if err != nil {
		t.Fatal(err)
	}
	secondEPUB, err := store.CreateRepresentation(ctx, editor, work.ID, "epub", "Second edition")
	if err != nil {
		t.Fatal(err)
	}
	representations, err := store.Representations(ctx, reader, work.ID, 50, 0)
	if err != nil || len(representations) != 3 {
		t.Fatalf("representations = %#v, %v", representations, err)
	}
	if epub.WorkID != work.ID || audio.WorkID != work.ID || secondEPUB.Kind != "epub" {
		t.Fatalf("independent representations = %#v %#v %#v", epub, audio, secondEPUB)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO media(id,representation_id,kind,path,sha256,created_at) VALUES ('epub-media',?,'epub','alice.epub',?,'2026-01-01T00:00:00Z'),('audio-media',?,'audio','alice.mp3',?,'2026-01-01T00:00:00Z')`, epub.ID, strings.Repeat("a", 64), audio.ID, strings.Repeat("b", 64)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO alignments(id,epub_media_id,audio_media_id,revision,state,created_at) VALUES ('alignment','epub-media','audio-media',1,'ready','2026-01-01T00:00:00Z'); INSERT INTO alignment_inputs(alignment_id,media_id,role) VALUES ('alignment','epub-media','epub'),('alignment','audio-media','audio')`); err != nil {
		t.Fatal(err)
	}
	if ok, err := store.CanAccessAlignment(ctx, reader, "alignment"); err != nil || !ok {
		t.Fatalf("reader alignment access = %v, %v", ok, err)
	}
	if ok, err := store.CanAccessAlignment(ctx, outsider, "alignment"); err != nil || ok {
		t.Fatalf("outsider alignment access = %v, %v", ok, err)
	}
	preference, err := store.SetWorkPreference(ctx, reader, WorkPreference{WorkID: work.ID, EPUBMediaID: "epub-media", AudioMediaID: "audio-media", AlignmentID: "alignment"})
	if err != nil || preference.AlignmentID != "alignment" {
		t.Fatalf("set preference = %#v, %v", preference, err)
	}
	if stored, err := store.WorkPreference(ctx, reader, work.ID); err != nil || stored.EPUBMediaID != "epub-media" || stored.AudioMediaID != "audio-media" {
		t.Fatalf("stored preference = %#v, %v", stored, err)
	}
	if _, err := store.SetWorkPreference(ctx, reader, WorkPreference{WorkID: work.ID, EPUBMediaID: "audio-media", AudioMediaID: "epub-media", AlignmentID: "alignment"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("mismatched preference = %v", err)
	}
	if _, err := store.WorkPreference(ctx, outsider, work.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider preference = %v", err)
	}
	audioOnlyWork, err := store.CreateWork(ctx, editor, first.ID, "Audio only", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateRepresentation(ctx, editor, audioOnlyWork.ID, "audio", "Solo narration"); err != nil {
		t.Fatal(err)
	}
	if values, err := store.Representations(ctx, reader, audioOnlyWork.ID, 50, 0); err != nil || len(values) != 1 || values[0].Kind != "audio" {
		t.Fatalf("standalone representation = %#v, %v", values, err)
	}
	if _, err := store.Representation(ctx, outsider, epub.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-library representation = %v", err)
	}
	if libraries, err := store.Libraries(ctx, reader, 50, 0); err != nil || len(libraries) != 1 || libraries[0].ID != first.ID {
		t.Fatalf("reader libraries = %#v, %v", libraries, err)
	}
	if libraries, err := store.Libraries(ctx, admin, 50, 0); err != nil || len(libraries) != 2 {
		t.Fatalf("admin libraries = %#v, %v", libraries, err)
	}
}

func TestMembershipConstraints(t *testing.T) {
	ctx := context.Background()
	store, accounts, admin := testCatalog(t)
	user := createUser(t, accounts, admin, "member")
	library, err := store.CreateLibrary(ctx, admin, "Library")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetMember(ctx, admin, library.ID, user.ID, "wizard"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid role = %v", err)
	}
	if err := store.RemoveMember(ctx, admin, library.ID, admin.ID); !errors.Is(err, ErrLastOwner) {
		t.Fatalf("last owner = %v", err)
	}
	if err := store.SetMember(ctx, admin, library.ID, admin.ID, "reader"); !errors.Is(err, ErrLastOwner) {
		t.Fatalf("demote last owner = %v", err)
	}
	if err := accounts.SetDisabled(ctx, admin, user.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := store.SetMember(ctx, admin, library.ID, user.ID, "reader"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("disabled member = %v", err)
	}
}

func TestBrowseWorksSearchFiltersPaginationAndIsolation(t *testing.T) {
	ctx := context.Background()
	store, accounts, admin := testCatalog(t)
	reader := createUser(t, accounts, admin, "browse-reader")
	outsider := createUser(t, accounts, admin, "browse-outsider")
	library, err := store.CreateLibrary(ctx, admin, "Classics")
	if err != nil {
		t.Fatal(err)
	}
	private, err := store.CreateLibrary(ctx, outsider, "Private")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetMember(ctx, admin, library.ID, reader.ID, "reader"); err != nil {
		t.Fatal(err)
	}
	alice, _ := store.CreateWork(ctx, admin, library.ID, "Alice_100%", "Lewis Carroll")
	wonderland, _ := store.CreateWork(ctx, admin, library.ID, "Wonderland", "Carroll")
	secret, _ := store.CreateWork(ctx, outsider, private.ID, "Secret Alice", "Nobody")
	epub, _ := store.CreateRepresentation(ctx, admin, alice.ID, "epub", "EPUB")
	audio, _ := store.CreateRepresentation(ctx, admin, alice.ID, "audio", "Audio")
	if _, err := store.db.ExecContext(ctx, `INSERT INTO media(id,representation_id,kind,path,sha256,created_at) VALUES('browse-epub',?,'epub','a.epub',?,'2026-01-01T00:00:00Z'),('browse-audio',?,'audio','a.mp3',?,'2026-01-01T00:00:00Z'); INSERT INTO alignments(id,epub_media_id,audio_media_id,revision,state,created_at) VALUES('browse-alignment','browse-epub','browse-audio',1,'ready','2026-01-01T00:00:00Z')`, epub.ID, strings.Repeat("c", 64), audio.ID, strings.Repeat("d", 64)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO alignment_segments(alignment_id,id,ordinal,text,epub_href,epub_locator,koreader_locator,audio_resource,audio_start_ms,audio_end_ms) VALUES('browse-alignment','segment',0,'Alice','chapter.xhtml','{"p":1}','/body/p[1]','a.mp3',0,1000),('browse-alignment','segment-2',1,'Later','chapter.xhtml','{"p":2}','/body/p[2]','a.mp3',1000,2000); INSERT INTO progress(user_id,work_id,alignment_id,segment_id,offset,revision,updated_at,source_device) VALUES(?,?,'browse-alignment','segment',500000,1,'2026-01-02T00:00:00Z','test'); INSERT INTO reading_activity_sessions(id,user_id,work_id,mode,started_at,last_seen_at,ended_at,active_seconds) VALUES('activity',?,?,'read','2026-01-02T00:00:00Z','2026-01-02T00:10:00Z','2026-01-02T00:10:00Z',600)`, reader.ID, alice.ID, reader.ID, alice.ID); err != nil {
		t.Fatal(err)
	}

	values, more, err := store.BrowseWorks(ctx, reader, BrowseOptions{Query: "alice_100%", Sort: "title", Limit: 1})
	if err != nil || more || len(values) != 1 || values[0].ID != alice.ID || !values[0].Readable || !values[0].Listenable || !values[0].Synchronized {
		t.Fatalf("escaped search = %#v, more=%v, err=%v", values, more, err)
	}
	values, more, err = store.BrowseWorks(ctx, reader, BrowseOptions{LibraryID: library.ID, Availability: "readable", Sort: "title", Limit: 1})
	if err != nil || more || len(values) != 1 || values[0].ID != alice.ID {
		t.Fatalf("readable filter = %#v, more=%v, err=%v", values, more, err)
	}
	values, more, err = store.BrowseWorks(ctx, reader, BrowseOptions{LibraryID: library.ID, Sort: "title", Limit: 1})
	if err != nil || !more || len(values) != 1 || values[0].ID != alice.ID {
		t.Fatalf("first page = %#v, more=%v, err=%v", values, more, err)
	}
	values, more, err = store.BrowseWorks(ctx, reader, BrowseOptions{LibraryID: library.ID, Sort: "title", Limit: 1, Offset: 1})
	if err != nil || more || len(values) != 1 || values[0].ID != wonderland.ID {
		t.Fatalf("second page = %#v, more=%v, err=%v", values, more, err)
	}
	values, _, err = store.BrowseWorks(ctx, reader, BrowseOptions{Availability: "in_progress", Sort: "progress"})
	if err != nil || len(values) != 1 || values[0].ID != alice.ID || !values[0].InProgress || values[0].ProgressUpdatedAt.IsZero() || values[0].CompletionPercent != 25 || values[0].ActiveSeconds != 600 || values[0].ReadingSeconds != 600 || values[0].ListeningSeconds != 0 || values[0].LastMode != "read" {
		t.Fatalf("progress browse = %#v, %v", values, err)
	}
	detail, err := store.WorkDetail(ctx, reader, alice.ID)
	if err != nil || detail.ID != alice.ID || !detail.InProgress || detail.CompletionPercent != 25 || detail.ActiveSeconds != 600 || detail.ReadingSeconds != 600 || detail.ListeningSeconds != 0 || detail.LastMode != "read" {
		t.Fatalf("work detail = %#v, %v", detail, err)
	}
	if err := store.SelectCover(ctx, admin, alice.ID, "open_library", "10521270"); err != nil {
		t.Fatal(err)
	}
	detail, err = store.WorkDetail(ctx, reader, alice.ID)
	if err != nil || detail.CoverURL != "https://covers.openlibrary.org/b/id/10521270-L.jpg?default=false" {
		t.Fatalf("selected cover = %q, %v", detail.CoverURL, err)
	}
	if err := store.SelectCover(ctx, reader, alice.ID, "open_library", "1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reader selected cover: %v", err)
	}
	if err := store.RestoreCover(ctx, admin, alice.ID); err != nil {
		t.Fatal(err)
	}
	detail, err = store.WorkDetail(ctx, reader, alice.ID)
	if err != nil || detail.CoverURL != "" {
		t.Fatalf("restored cover = %q, %v", detail.CoverURL, err)
	}
	values, _, err = store.BrowseWorks(ctx, reader, BrowseOptions{Sort: "title"})
	if err != nil || len(values) != 2 {
		t.Fatalf("authorized global browse = %#v, %v", values, err)
	}
	for _, value := range values {
		if value.ID == secret.ID {
			t.Fatal("cross-library work leaked")
		}
	}
}
