package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/database"
)

const (
	testPassword = "a-secure-test-password"
)

func openTestStore(t *testing.T, options Options) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "aldus.db")
	db, err := database.Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	store, err := New(db, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return store, path
}

func TestSetupAndSessionLifecycle(t *testing.T) {
	ctx := context.Background()
	store, path := openTestStore(t, Options{SessionTTL: time.Hour})
	available, err := store.SetupAvailable(ctx)
	if err != nil || !available {
		t.Fatalf("SetupAvailable() = %v, %v", available, err)
	}
	session, err := store.Setup(ctx, Credentials{Username: "Alice", DisplayName: "Alice Admin", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	if !session.User.Admin || session.User.Username != "Alice" {
		t.Fatalf("setup user = %#v", session.User)
	}
	available, err = store.SetupAvailable(ctx)
	if err != nil || available {
		t.Fatalf("SetupAvailable() after setup = %v, %v", available, err)
	}
	if _, err := store.Setup(ctx, Credentials{Username: "other", Password: testPassword}); !errors.Is(err, ErrSetupClosed) {
		t.Fatalf("second setup error = %v", err)
	}

	var passwordHash string
	if err := store.db.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id=?`, session.User.ID).Scan(&passwordHash); err != nil {
		t.Fatal(err)
	}
	if passwordHash == testPassword {
		t.Fatal("password stored in plaintext")
	}
	var rawCount, hashCount int
	hash := sha256.Sum256([]byte(session.Token))
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions WHERE token_hash=?`, []byte(session.Token)).Scan(&rawCount); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions WHERE token_hash=?`, hash[:]).Scan(&hashCount); err != nil {
		t.Fatal(err)
	}
	if rawCount != 0 || hashCount != 1 {
		t.Fatalf("stored session raw=%d hashed=%d", rawCount, hashCount)
	}

	login, err := store.Login(ctx, Credentials{Username: " alice ", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Login(ctx, Credentials{Username: "missing", Password: testPassword}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("missing user error = %v", err)
	}
	if _, err := store.Login(ctx, Credentials{Username: "alice", Password: "wrong"}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("wrong password error = %v", err)
	}
	if err := store.db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := database.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := New(db, Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if user, err := reopened.Authenticate(ctx, login.Token); err != nil || user.ID != session.User.ID {
		t.Fatalf("persisted session user = %#v, %v", user, err)
	}
	if err := reopened.Logout(ctx, login.Token); err != nil {
		t.Fatal(err)
	}
	if err := reopened.Logout(ctx, login.Token); err != nil {
		t.Fatalf("idempotent logout: %v", err)
	}
	if _, err := reopened.Authenticate(ctx, login.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("revoked session error = %v", err)
	}
	if _, err := reopened.Authenticate(ctx, "invalid"); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("invalid session error = %v", err)
	}
}

func TestConcurrentSetupCreatesOneAdmin(t *testing.T) {
	store, _ := openTestStore(t, Options{})
	start := make(chan struct{})
	errorsSeen := make(chan error, 2)
	var wait sync.WaitGroup
	for _, username := range []string{"alice", "other"} {
		wait.Add(1)
		go func(username string) {
			defer wait.Done()
			<-start
			_, err := store.Setup(context.Background(), Credentials{Username: username, Password: testPassword})
			errorsSeen <- err
		}(username)
	}
	close(start)
	wait.Wait()
	close(errorsSeen)
	var successes, closed int
	for err := range errorsSeen {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrSetupClosed):
			closed++
		default:
			t.Fatalf("setup error = %v", err)
		}
	}
	var admins int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM users WHERE is_admin=1`).Scan(&admins); err != nil {
		t.Fatal(err)
	}
	if successes != 1 || closed != 1 || admins != 1 {
		t.Fatalf("successes=%d closed=%d admins=%d", successes, closed, admins)
	}
}

func TestExpiredAndDisabledSessionsAreRejected(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t, Options{})
	session, err := store.Setup(ctx, Credentials{Username: "alice", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(session.Token))
	if _, err := store.db.ExecContext(ctx, `UPDATE sessions SET expires_at=? WHERE token_hash=?`, formatTime(time.Now().Add(-time.Hour)), hash[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Authenticate(ctx, session.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expired session error = %v", err)
	}
	session, err = store.Login(ctx, Credentials{Username: "alice", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE users SET disabled=1 WHERE id=?`, session.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Authenticate(ctx, session.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("disabled session error = %v", err)
	}
	if _, err := store.Login(ctx, Credentials{Username: "alice", Password: testPassword}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("disabled login error = %v", err)
	}
}

func TestDemoSessionLifecycle(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t, Options{DemoLibraryID: "demo-library", DemoTTL: time.Hour, DemoCapacity: 1})
	admin, err := store.Setup(ctx, Credentials{Username: "admin", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO libraries(id,name,created_at,updated_at) VALUES('demo-library','Demo',?,?)`, formatTime(time.Now().UTC()), formatTime(time.Now().UTC())); err != nil {
		t.Fatal(err)
	}
	guest, err := store.CreateDemoSession(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if guest.User.Admin || guest.User.DemoExpiresAt == nil || guest.User.Username == admin.User.Username {
		t.Fatalf("demo user = %#v", guest.User)
	}
	if guest.DemoPassword == "" {
		t.Fatal("demo password is empty")
	}
	if guest.DemoPairingCode == "" || guest.DemoPairingExpiresAt.IsZero() {
		t.Fatalf("demo pairing = %q %v", guest.DemoPairingCode, guest.DemoPairingExpiresAt)
	}
	paired, err := store.RedeemDemoPairingCode(ctx, strings.ToLower(guest.DemoPairingCode))
	if err != nil || paired.User.ID != guest.User.ID {
		t.Fatalf("paired demo = %#v, %v", paired.User, err)
	}
	if _, err := store.RedeemDemoPairingCode(ctx, guest.DemoPairingCode); !errors.Is(err, ErrInvalidPairingCode) {
		t.Fatalf("reused pairing code error = %v", err)
	}
	if _, err := store.Login(ctx, Credentials{Username: guest.User.Username, Password: guest.DemoPassword}); err != nil {
		t.Fatalf("demo login = %v", err)
	}
	users, err := store.Users(ctx, admin.User, 50, 0)
	if err != nil || len(users) != 1 || users[0].ID != admin.User.ID {
		t.Fatalf("admin users = %#v, %v", users, err)
	}
	var role string
	var exclusive, canRequest, canBypass, canAdvanced int
	if err := store.db.QueryRowContext(ctx, `SELECT role,exclusive,can_request_acquisitions,can_bypass_acquisition_approval,can_advanced_acquisition_request FROM library_members WHERE user_id=?`, guest.User.ID).Scan(&role, &exclusive, &canRequest, &canBypass, &canAdvanced); err != nil {
		t.Fatal(err)
	}
	if role != "reader" || exclusive != 0 || canRequest != 0 || canBypass != 0 || canAdvanced != 0 {
		t.Fatalf("demo membership = %q %d %d %d %d", role, exclusive, canRequest, canBypass, canAdvanced)
	}
	if _, err := store.CreateDemoSession(ctx); !errors.Is(err, ErrDemoCapacity) {
		t.Fatalf("capacity error = %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE users SET demo_expires_at=? WHERE id=?`, formatTime(time.Now().Add(-time.Hour)), guest.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Authenticate(ctx, guest.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expired guest authentication = %v", err)
	}
	if err := store.CleanupExpiredDemoUsers(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE id=?`, guest.User.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("expired guest count = %d, %v", count, err)
	}
	if _, err := store.CreateDemoSession(ctx); err != nil {
		t.Fatalf("replacement guest = %v", err)
	}
}

func TestDemoSessionRequiresConfiguredLibrary(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t, Options{})
	if store.DemoAvailable() {
		t.Fatal("demo unexpectedly available")
	}
	if _, err := store.CreateDemoSession(ctx); !errors.Is(err, ErrDemoDisabled) {
		t.Fatalf("disabled demo error = %v", err)
	}
	configured, _ := openTestStore(t, Options{DemoLibraryID: "missing"})
	if ready, err := configured.DemoReady(ctx); err != nil || ready {
		t.Fatalf("missing demo library ready = %v, %v", ready, err)
	}
	if _, err := configured.CreateDemoSession(ctx); !errors.Is(err, ErrDemoDisabled) {
		t.Fatalf("missing library error = %v", err)
	}
}

func TestAdminUserManagement(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t, Options{})
	session, err := store.Setup(ctx, Credentials{Username: "admin", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetDisabled(ctx, session.User, session.User.ID, true); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("disable last admin = %v", err)
	}
	user, _, err := store.CreateUser(ctx, session.User, Credentials{Username: "reader", Password: testPassword}, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.CreateUser(ctx, session.User, Credentials{Username: "READER", Password: testPassword}, false); !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("duplicate username = %v", err)
	}
	if err := store.SetDisabled(ctx, user, user.ID, true); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-admin disable = %v", err)
	}
	now := formatTime(time.Now().UTC())
	if _, err := store.db.ExecContext(ctx, `INSERT INTO libraries(id,name,created_at,updated_at) VALUES('owned','Owned',?,?)`, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('owned',?,'owner',?)`, user.ID, now); err != nil {
		t.Fatal(err)
	}
	if err := store.SetDisabled(ctx, session.User, user.ID, true); !errors.Is(err, ErrLastOwner) {
		t.Fatalf("disable last library owner = %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('owned',?,'owner',?)`, session.User.ID, now); err != nil {
		t.Fatal(err)
	}
	if err := store.SetDisabled(ctx, session.User, user.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Login(ctx, Credentials{Username: "reader", Password: testPassword}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("disabled login = %v", err)
	}
	users, err := store.Users(ctx, session.User, 50, 0)
	if err != nil || len(users) != 2 {
		t.Fatalf("users = %#v, %v", users, err)
	}
}

func TestAccountCredentialLifecycle(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t, Options{})
	admin, err := store.Setup(ctx, Credentials{Username: "admin", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	reader, temporaryPassword, err := store.CreateUser(ctx, admin.User, Credentials{Username: "reader"}, false)
	if err != nil || temporaryPassword == "" || !reader.MustChangeCredentials {
		t.Fatalf("created account = %#v, temporary=%q, %v", reader, temporaryPassword, err)
	}
	temporarySession, err := store.Login(ctx, Credentials{Username: reader.Username, Password: temporaryPassword})
	if err != nil || !temporarySession.User.MustChangeCredentials {
		t.Fatalf("temporary login = %#v, %v", temporarySession.User, err)
	}
	claimed, err := store.ClaimAccount(ctx, temporarySession.User, Credentials{Username: "reader-owned", DisplayName: "Reader Owned", Password: testPassword})
	if err != nil || claimed.User.MustChangeCredentials || claimed.User.Username != "reader-owned" {
		t.Fatalf("claimed account = %#v, %v", claimed.User, err)
	}
	if _, err := store.Authenticate(ctx, temporarySession.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("temporary session remains valid: %v", err)
	}
	otherSession, err := store.Login(ctx, Credentials{Username: "reader-owned", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	changed, err := store.ChangePassword(ctx, claimed.User, testPassword, "a-different-secure-password")
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{claimed.Token, otherSession.Token} {
		if _, err := store.Authenticate(ctx, token); !errors.Is(err, ErrUnauthenticated) {
			t.Fatalf("old session remains valid: %v", err)
		}
	}
	updated, err := store.UpdateDisplayName(ctx, changed.User, "Updated Reader")
	if err != nil || updated.DisplayName != "Updated Reader" {
		t.Fatalf("updated profile = %#v, %v", updated, err)
	}
	resetPassword, err := store.ResetPassword(ctx, admin.User, reader.ID)
	if err != nil || resetPassword == "" {
		t.Fatalf("password reset = %q, %v", resetPassword, err)
	}
	if _, err := store.Authenticate(ctx, changed.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("password-change session remains after reset: %v", err)
	}
	resetSession, err := store.Login(ctx, Credentials{Username: "reader-owned", Password: resetPassword})
	if err != nil || !resetSession.User.MustChangeCredentials {
		t.Fatalf("reset login = %#v, %v", resetSession.User, err)
	}
}

func TestHostAdministratorPasswordReset(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t, Options{})
	admin, err := store.Setup(ctx, Credentials{Username: "admin", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	temporaryPassword, err := store.ResetAdministratorPasswordFromHost(ctx, "ADMIN")
	if err != nil || temporaryPassword == "" {
		t.Fatalf("host reset = %q, %v", temporaryPassword, err)
	}
	if _, err := store.Authenticate(ctx, admin.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("admin session remains valid: %v", err)
	}
	reset, err := store.Login(ctx, Credentials{Username: "admin", Password: temporaryPassword})
	if err != nil || !reset.User.MustChangeCredentials {
		t.Fatalf("reset admin login = %#v, %v", reset.User, err)
	}
}

func TestDeleteCurrentUser(t *testing.T) {
	ctx := context.Background()
	store, _ := openTestStore(t, Options{DemoLibraryID: "library"})
	admin, err := store.Setup(ctx, Credentials{Username: "admin", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteCurrentUser(ctx, admin.User, testPassword); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("delete last admin = %v", err)
	}
	secondAdmin, _, err := store.CreateUser(ctx, admin.User, Credentials{Username: "second-admin", Password: testPassword}, true)
	if err != nil {
		t.Fatal(err)
	}
	reader, _, err := store.CreateUser(ctx, admin.User, Credentials{Username: "reader", Password: testPassword}, false)
	if err != nil {
		t.Fatal(err)
	}
	now := formatTime(time.Now().UTC())
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library',?,?)`, []any{now, now}},
		{`INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('library',?,'owner',?)`, []any{reader.ID, now}},
		{`INSERT INTO reader_credentials(id,user_id,label,secret_hash,sync_key_hash,created_at) VALUES('credential',?,'Reader','secret','sync',?)`, []any{reader.ID, now}},
		{`INSERT INTO collections(id,user_id,title,created_at,updated_at) VALUES('collection',?,'Favorites',?,?)`, []any{reader.ID, now, now}},
		{`INSERT INTO acquisition_pairs(id,library_id,requested_by,query,created_at,updated_at) VALUES('pair','library',?,'Book',?,?)`, []any{reader.ID, now, now}},
		{`INSERT INTO acquisition_requests(id,library_id,requested_by,query,status,created_at,updated_at,pair_id) VALUES('request','library',?,'Book','requested',?,?,'pair')`, []any{reader.ID, now, now}},
		{`INSERT INTO title_requests(id,library_id,requested_by,title,created_at,updated_at) VALUES('title','library',?,'Book',?,?)`, []any{reader.ID, now, now}},
	}
	for _, statement := range statements {
		if _, err := store.db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("fixture %q: %v", statement.query, err)
		}
	}
	readerSession, err := store.Login(ctx, Credentials{Username: "reader", Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteCurrentUser(ctx, reader, "wrong-password"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("delete with wrong password = %v", err)
	}
	if err := store.DeleteCurrentUser(ctx, reader, testPassword); !errors.Is(err, ErrLastOwner) {
		t.Fatalf("delete last library owner = %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('library',?,'owner',?)`, secondAdmin.ID, now); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteCurrentUser(ctx, reader, testPassword); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Authenticate(ctx, readerSession.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("deleted session authentication = %v", err)
	}
	for _, table := range []string{"users", "library_members", "reader_credentials", "collections"} {
		var count int
		if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+table+` WHERE `+map[string]string{"users": "id", "library_members": "user_id", "reader_credentials": "user_id", "collections": "user_id"}[table]+`=?`, reader.ID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("%s count=%d, %v", table, count, err)
		}
	}
	for _, table := range []string{"acquisition_pairs", "acquisition_requests", "title_requests"} {
		var anonymous int
		if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+table+` WHERE requested_by IS NULL`).Scan(&anonymous); err != nil || anonymous != 1 {
			t.Fatalf("%s anonymous=%d, %v", table, anonymous, err)
		}
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('library',?,'owner',?)`, admin.User.ID, now); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteCurrentUser(ctx, secondAdmin, testPassword); err != nil {
		t.Fatalf("delete non-last admin: %v", err)
	}
	guest, err := store.CreateDemoSession(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteCurrentUser(ctx, guest.User, ""); err != nil {
		t.Fatalf("delete guest: %v", err)
	}
}
