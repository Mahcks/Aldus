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
